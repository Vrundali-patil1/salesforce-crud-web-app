import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API_URL = "http://localhost:5000";

const OBJECTS = {
  Account: {
    fields: ["Id", "Name", "Type", "Industry", "Phone"],
    editableFields: ["Name", "Type", "Industry", "Phone"],
  },
  Opportunity: {
    fields: ["Id", "Name", "StageName", "Amount", "CloseDate"],
    editableFields: ["Name", "StageName", "Amount", "CloseDate"],
  },
  Lead: {
    fields: ["Id", "FirstName", "LastName", "Company", "Email"],
    editableFields: ["FirstName", "LastName", "Company", "Email"],
  },
  Contact: {
    fields: ["Id", "FirstName", "LastName", "Email", "Phone"],
    editableFields: ["FirstName", "LastName", "Email", "Phone"],
  },
  Case: {
    fields: ["Id", "CaseNumber", "Subject", "Status", "Priority"],
    editableFields: ["Subject", "Status", "Priority"],
  },
};

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [selectedObject, setSelectedObject] = useState("Account");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextRecordsUrl, setNextRecordsUrl] = useState(null);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});

  const fields = OBJECTS[selectedObject].fields;
  const editableFields = OBJECTS[selectedObject].editableFields;

  // Check Salesforce authentication
  const checkAuth = async () => {
    try {
      const response = await axios.get(`${API_URL}/auth/status`, {
        withCredentials: true,
      });

      setAuthenticated(response.data.authenticated);
    } catch (err) {
      setError("Unable to check Salesforce login status.");
    }
  };

  // Load first 20 Salesforce records
  const loadRecords = async () => {
    if (!authenticated) return;

    try {
      setLoading(true);
      setError("");

      const response = await axios.get(
        `${API_URL}/api/records/${selectedObject}`,
        {
          withCredentials: true,
        }
      );

      setRecords(response.data.records || []);
      setNextRecordsUrl(response.data.nextRecordsUrl || null);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Failed to load Salesforce records."
      );
    } finally {
      setLoading(false);
    }
  };

  // Load next 20 Salesforce records
  const loadMoreRecords = async () => {
    if (!nextRecordsUrl || loadingMore) return;

    try {
      setLoadingMore(true);
      setError("");

      const response = await axios.get(
        `${API_URL}/api/records/${selectedObject}`,
        {
          params: {
            nextUrl: nextRecordsUrl,
          },
          withCredentials: true,
        }
      );

      setRecords((previousRecords) => [
        ...previousRecords,
        ...(response.data.records || []),
      ]);

      setNextRecordsUrl(response.data.nextRecordsUrl || null);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Failed to load more records."
      );
    } finally {
      setLoadingMore(false);
    }
  };

  // Check authentication when application starts
  useEffect(() => {
    checkAuth();
  }, []);

  // Load first page when object/authentication changes
  useEffect(() => {
    loadRecords();
  }, [selectedObject, authenticated]);

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition =
        window.innerHeight + window.scrollY;

      const pageHeight =
        document.documentElement.scrollHeight;

      const distanceFromBottom =
        pageHeight - scrollPosition;

      if (
        distanceFromBottom < 500 &&
        nextRecordsUrl &&
        !loadingMore
      ) {
        loadMoreRecords();
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [nextRecordsUrl, loadingMore]);

  const login = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  const logout = async () => {
    try {
      await axios.get(`${API_URL}/auth/logout`, {
        withCredentials: true,
      });

      setAuthenticated(false);
      setRecords([]);
      setNextRecordsUrl(null);
    } catch (err) {
      setError("Logout failed.");
    }
  };

  // Open create form
  const openCreateForm = () => {
    const initialData = {};

    editableFields.forEach((field) => {
      initialData[field] = "";
    });

    setFormData(initialData);
    setEditingRecord(null);
    setShowForm(true);
  };

  // Open edit form
  const openEditForm = (record) => {
    const data = {};

    editableFields.forEach((field) => {
      data[field] = record[field] ?? "";
    });

    setFormData(data);
    setEditingRecord(record);
    setShowForm(true);
  };

  // Handle form input
  const handleInputChange = (event) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // Create or update record
  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setError("");

      if (editingRecord) {
        await axios.patch(
          `${API_URL}/api/records/${selectedObject}/${editingRecord.Id}`,
          formData,
          {
            withCredentials: true,
          }
        );
      } else {
        await axios.post(
          `${API_URL}/api/records/${selectedObject}`,
          formData,
          {
            withCredentials: true,
          }
        );
      }

      setShowForm(false);
      setEditingRecord(null);
      setFormData({});

      await loadRecords();
    } catch (err) {
      setError(
        err.response?.data?.details ||
          err.response?.data?.error ||
          "Operation failed."
      );
    }
  };

  // Delete record
  const deleteRecord = async (recordId) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this ${selectedObject} record?`
    );

    if (!confirmed) return;

    try {
      setError("");

      await axios.delete(
        `${API_URL}/api/records/${selectedObject}/${recordId}`,
        {
          withCredentials: true,
        }
      );

      await loadRecords();
    } catch (err) {
      setError(
        err.response?.data?.details ||
          err.response?.data?.error ||
          "Delete failed."
      );
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Salesforce CRUD Web App</h1>
          <p>Manage Salesforce records from one application</p>
        </div>

        {!authenticated ? (
          <button className="login-btn" onClick={login}>
            Login with Salesforce
          </button>
        ) : (
          <button className="logout-btn" onClick={logout}>
            Logout
          </button>
        )}
      </header>

      <main className="container">
        {!authenticated ? (
          <div className="login-card">
            <h2>Welcome</h2>

            <p>
              Login with Salesforce to manage Account, Opportunity,
              Lead, Contact, and Case records.
            </p>

            <button className="login-btn large" onClick={login}>
              Login with Salesforce
            </button>
          </div>
        ) : (
          <>
            <div className="controls">
              <div>
                <label htmlFor="object-select">
                  Salesforce Object
                </label>

                <select
                  id="object-select"
                  value={selectedObject}
                  onChange={(event) => {
                    setSelectedObject(event.target.value);
                    setRecords([]);
                    setNextRecordsUrl(null);
                    setShowForm(false);
                  }}
                >
                  {Object.keys(OBJECTS).map((objectName) => (
                    <option key={objectName} value={objectName}>
                      {objectName}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="create-btn"
                onClick={openCreateForm}
              >
                + Create Record
              </button>
            </div>

            {error && <div className="error">{error}</div>}

            {showForm && (
              <div className="form-card">
                <div className="form-header">
                  <h2>
                    {editingRecord ? "Edit" : "Create"} {selectedObject}
                  </h2>

                  <button
                    className="close-btn"
                    onClick={() => setShowForm(false)}
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="form-grid">
                    {editableFields.map((field) => (
                      <div className="form-field" key={field}>
                        <label htmlFor={field}>{field}</label>

                        <input
                          id={field}
                          name={field}
                          value={formData[field] ?? ""}
                          onChange={handleInputChange}
                          required={
                            field === "Name" ||
                            field === "Company" ||
                            field === "Subject"
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="cancel-btn"
                      onClick={() => setShowForm(false)}
                    >
                      Cancel
                    </button>

                    <button type="submit" className="save-btn">
                      {editingRecord
                        ? "Update Record"
                        : "Create Record"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="table-card">
              <div className="table-header">
                <div>
                  <h2>{selectedObject} Records</h2>
                  <span>
                    {records.length} records loaded
                  </span>
                </div>
              </div>

              {loading ? (
                <div className="loading">
                  Loading records...
                </div>
              ) : records.length === 0 ? (
                <div className="empty">
                  No records found.
                </div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        {fields.map((field) => (
                          <th key={field}>{field}</th>
                        ))}

                        <th>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {records.map((record) => (
                        <tr key={record.Id}>
                          {fields.map((field) => (
                            <td key={field}>
                              {record[field] ?? "-"}
                            </td>
                          ))}

                          <td>
                            <button
                              className="edit-btn"
                              onClick={() =>
                                openEditForm(record)
                              }
                            >
                              Edit
                            </button>

                            <button
                              className="delete-btn"
                              onClick={() =>
                                deleteRecord(record.Id)
                              }
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {loadingMore && (
                <div className="loading">
                  Loading more records...
                </div>
              )}

              {!nextRecordsUrl && records.length > 0 && (
                <div className="loading">
                  All available records loaded.
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;