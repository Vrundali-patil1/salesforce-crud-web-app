const express = require("express");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: "lax"
    }
}));

// Generate PKCE code verifier
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
}

// Create code challenge from verifier
function generateCodeChallenge(verifier) {
    return crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
}

// Home/test route
app.get("/", (req, res) => {
    res.json({
        message: "Salesforce CRUD API is running"
    });
});

// Start Salesforce OAuth login
app.get("/auth/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    req.session.oauthState = state;
    req.session.codeVerifier = codeVerifier;

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.SALESFORCE_CLIENT_ID,
        redirect_uri: process.env.SALESFORCE_CALLBACK_URL,
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256"
    });

    const authorizationUrl =
        `${process.env.SALESFORCE_LOGIN_URL}/services/oauth2/authorize?${params.toString()}`;

    res.redirect(authorizationUrl);
});

// Salesforce OAuth callback
app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).send("Missing authorization code or state.");
        }

        if (state !== req.session.oauthState) {
            return res.status(400).send("Invalid OAuth state.");
        }

        const tokenResponse = await axios.post(
            `${process.env.SALESFORCE_LOGIN_URL}/services/oauth2/token`,
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: process.env.SALESFORCE_CLIENT_ID,
                client_secret: process.env.SALESFORCE_CLIENT_SECRET,
                redirect_uri: process.env.SALESFORCE_CALLBACK_URL,
                code: code,
                code_verifier: req.session.codeVerifier
            }).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        req.session.salesforce = {
            accessToken: tokenResponse.data.access_token,
            refreshToken: tokenResponse.data.refresh_token,
            instanceUrl: tokenResponse.data.instance_url
        };

        delete req.session.oauthState;
        delete req.session.codeVerifier;

        res.send(`
            <h2>Salesforce login successful!</h2>
            <p>You are now authenticated with Salesforce.</p>
            <p>You can close this page for now.</p>
        `);

    } catch (error) {
        console.error(
            "OAuth Error:",
            error.response?.data || error.message
        );

        res.status(500).send("Salesforce authentication failed.");
    }
});

// Salesforce objects and fields used by the application
const OBJECT_CONFIG = {
    Account: {
        fields: ["Id", "Name", "Type", "Industry", "Phone"]
    },

    Opportunity: {
        fields: ["Id", "Name", "StageName", "Amount", "CloseDate"]
    },

    Lead: {
        fields: ["Id", "FirstName", "LastName", "Company", "Email"]
    },

    Contact: {
        fields: ["Id", "FirstName", "LastName", "Email", "Phone"]
    },

    Case: {
        fields: ["Id", "CaseNumber", "Subject", "Status", "Priority"]
    }
};

// Get Salesforce records with pagination
app.get("/api/records/:object", async (req, res) => {
    try {
        if (!req.session.salesforce) {
            return res.status(401).json({
                error: "Not authenticated with Salesforce"
            });
        }

        const objectName = req.params.object;
        const config = OBJECT_CONFIG[objectName];

        if (!config) {
            return res.status(400).json({
                error: "Invalid Salesforce object"
            });
        }

        const { accessToken, instanceUrl } = req.session.salesforce;

        const nextUrl = req.query.nextUrl;

        let response;

        if (nextUrl) {
            // Fetch the next page using Salesforce's nextRecordsUrl
            response = await axios.get(
                `${instanceUrl}${nextUrl}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );
        } else {
            // First page: load 20 records
            const query = `
                SELECT ${config.fields.join(", ")}
                FROM ${objectName}
                ORDER BY CreatedDate DESC
                LIMIT 20
            `;

            response = await axios.get(
                `${instanceUrl}/services/data/v66.0/query`,
                {
                    params: {
                        q: query
                    },
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );
        }

        res.json({
            object: objectName,
            fields: config.fields,
            totalSize: response.data.totalSize,
            records: response.data.records,
            nextRecordsUrl: response.data.nextRecordsUrl || null
        });

    } catch (error) {
        console.error(
            "Salesforce Pagination Error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to fetch Salesforce records",
            details: error.response?.data || error.message
        });
    }
});

       

// Create a Salesforce record
app.post("/api/records/:object", async (req, res) => {
    try {
        if (!req.session.salesforce) {
            return res.status(401).json({
                error: "Not authenticated with Salesforce"
            });
        }

        const objectName = req.params.object;
        const config = OBJECT_CONFIG[objectName];

        if (!config) {
            return res.status(400).json({
                error: "Invalid Salesforce object"
            });
        }

        const { accessToken, instanceUrl } = req.session.salesforce;

        const response = await axios.post(
            `${instanceUrl}/services/data/v66.0/sobjects/${objectName}`,
            req.body,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.status(201).json(response.data);

    } catch (error) {
        console.error(
            "Salesforce Create Error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to create Salesforce record",
            details: error.response?.data || error.message
        });
    }
});

// Update a Salesforce record
app.patch("/api/records/:object/:id", async (req, res) => {
    try {
        if (!req.session.salesforce) {
            return res.status(401).json({
                error: "Not authenticated with Salesforce"
            });
        }

        const objectName = req.params.object;
        const recordId = req.params.id;
        const config = OBJECT_CONFIG[objectName];

        if (!config) {
            return res.status(400).json({
                error: "Invalid Salesforce object"
            });
        }

        const { accessToken, instanceUrl } = req.session.salesforce;

        await axios.patch(
            `${instanceUrl}/services/data/v66.0/sobjects/${objectName}/${recordId}`,
            req.body,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.json({
            success: true,
            message: `${objectName} record updated successfully`
        });

    } catch (error) {
        console.error(
            "Salesforce Update Error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to update Salesforce record",
            details: error.response?.data || error.message
        });
    }
});

// Delete a Salesforce record
app.delete("/api/records/:object/:id", async (req, res) => {
    try {
        if (!req.session.salesforce) {
            return res.status(401).json({
                error: "Not authenticated with Salesforce"
            });
        }

        const objectName = req.params.object;
        const recordId = req.params.id;
        const config = OBJECT_CONFIG[objectName];

        if (!config) {
            return res.status(400).json({
                error: "Invalid Salesforce object"
            });
        }

        const { accessToken, instanceUrl } = req.session.salesforce;

        await axios.delete(
            `${instanceUrl}/services/data/v66.0/sobjects/${objectName}/${recordId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        res.json({
            success: true,
            message: `${objectName} record deleted successfully`
        });

    } catch (error) {
        console.error(
            "Salesforce Delete Error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to delete Salesforce record",
            details: error.response?.data || error.message
        });
    }
});



// Check authentication status
app.get("/auth/status", (req, res) => {
    if (req.session.salesforce) {
        return res.json({
            authenticated: true
        });
    }

    res.json({
        authenticated: false
    });
});

// Logout
app.get("/auth/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({
            message: "Logged out successfully"
        });
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});