# Bot Omega - Google Workspace Group Management Agent

Bot Omega is a powerful, resilient Google Chat bot designed to streamline **Google Workspace group administration** tasks (e.g., adding/removing members, changing roles) and provide instant answers to common technical FAQs within your organization.

It leverages Google's core technologies, including the **Admin SDK**, **Secret Manager** for secure credentials, and the **Gemini API** for natural language understanding and semantic search.

---

## Key Features

* **Natural Language Group Management:** Users can interact using natural language (e.g., "add John Doe to support@") thanks to intent recognition powered by the **Gemini AI**.
* **Secure Credentials:** All sensitive service account keys are loaded securely at runtime via **Google Secret Manager (GSM)**, avoiding exposure in the code or environment variables.
* **Flexible User/Group Resolution:** Resolves users and groups using full emails, partial emails, or display names (e.g., "Saul Rodriguez").
* **Dual FAQ System:** Provides fast answers via a **Deterministic Search** against a Firestore-loaded FAQ array, with a **Semantic Search (Gemini)** fallback for complex queries.
* **Manager/Owner Permissions:** Enforces strict access control, allowing only designated **Managers, Owners**, or the Global Admin to modify group memberships.
* **Role Change & Request:** Supports changing member roles to `MANAGER` and a formal process for users to request `MANAGER` permissions via email notification.

---

## Tech Stack & Architecture

This bot is built on a resilient serverless architecture:

| Technology | Purpose |
| :--- | :--- |
| **Node.js / Express** | Runtime environment and web server to handle Google Chat events. |
| **Google Admin SDK** | Primary tool for managing users and groups within Google Workspace. |
| **Google Secret Manager** | Secure storage and retrieval of the Admin SDK Service Account credentials. |
| **Google Firestore** | Dynamic loading of the AI prompts, conversational logic, and the structured FAQ knowledge base. |
| **Gemini API** | Used for Natural Language Understanding (NLU) to map user input to group management commands (Intents). |
| **Google Chat API** | Primary communication interface. |

---

## Setup and Deployment

### Prerequisites

1.  A Google Workspace Domain with **Domain-Wide Delegation (DWD)** enabled.
2.  A Google Cloud Project with the **Admin SDK API**, **Secret Manager API**, and **Firestore API** enabled.
3.  A **Service Account** with the necessary scopes (as defined in `initializeAdminSdk` function) delegated by a Super Administrator.

### Configuration Steps (Simplified)

1.  **Secret Manager:** Store your Admin SDK Service Account JSON key as a secret in Google Secret Manager (as defined by `secretName` in `index.js`).
2.  **Environment Variables (`.env`):**
    * `PORT`: Port to run the server on (e.g., `8080`).
    * `DELEGATED_ADMIN_EMAIL`: The email of the admin user to impersonate (for DWD).
    * `DOMINIO`: Your Google Workspace domain (e.g., `omegacrmconsulting.com`).
    * `NOTIFICATION_EMAIL_RECIPIENT`: The email address for management request notifications.
    * `GEMINI_API_KEY`: Your API key for accessing the Gemini model.
3.  **Firestore Setup:** Create a `Collection Bot` collection to store the main management prompt, and an `faq` collection for the knowledge base.
4.  **Installation:**
    ```bash
    git clone [https://github.com/fjmorenor/botgooglechat.git](https://github.com/fjmorenor/botgooglechat.git)
    cd botgooglechat
    npm install
    # Note: Use your preferred deployment method (Cloud Run, Compute Engine, etc.)
    ```

---

## Usage Examples

Users can interact with the bot in a Google Chat space using simple language or the following commands:

| Action | Example Command | Description |
| :--- | :--- | :--- |
| **Add Member** | `add user@ to group.test@` | Adds one or more users to a group. |
| **Remove Member** | `remove John Doe from marketing@` | Removes a user from a specified group. |
| **Change Role** | `make saul manager of support@` | Updates a member's role to MANAGER. |
| **List Members** | `/miembros support@` | Shows all members and their roles in a group. |
| **Leave Group** | `/abandonar office.group@` | Removes the user themselves from the group. |
| **FAQ Query** | `how can i reset my password?` | Answers common questions using the knowledge base. |

---

## Security Notice

**CRITICAL:** This repository uses a `.gitignore` file to exclude sensitive files like:
* `terraform-key.json`
* `*.tfstate` (Terraform state files)
* `.env` (Environment variables)

**DO NOT** upload credentials or state files to your repository. **Bot Omega** fetches credentials securely from **Google Secret Manager**.
