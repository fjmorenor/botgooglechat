# Bot Omega: Google Workspace Group Management Agent

This is **Bot Omega**, a resilient chat tool designed to handle daily **Google Workspace Group administration** tasks (like managing members and roles) and act as a technical assistant by providing instant answers to FAQs.

The project combines Google Cloud's power: **Gemini AI** for understanding natural language and the precise execution capabilities of the **Admin SDK**.

---

## Core Capabilities

This bot delivers secure and efficient management of your environment:

* **Conversational Administration:** Users request actions using natural sentences (e.g., "add user@ to group.test@"). The **Gemini AI** interprets the intent behind the text.
* **Security First:** The sensitive Service Account keys are loaded securely at runtime via **Google Secret Manager (GSM)**, ensuring they are never exposed in code or variables.
* **Flexible Resolution:** The bot can find users and groups by accepting full emails, partial emails, or display names (e.g., "Juan Pérez").
* **Quick Support (FAQs):** It answers support questions using a two-part strategy: first, a fast, direct lookup against the knowledge base, and then a **semantic fallback with Gemini** for complex queries.
* **Permission Control:** It enforces organizational rules, allowing group management only to approved **Managers, Owners**, or the Global Administrator.

---

## Technology Stack and Project Flow

The bot is designed on a modern, cloud-native architecture ready for serverless deployment.

| Technology | Role in the Project |
| :--- | :--- |
| **Node.js / Express** | Provides the execution environment and manages receiving chat events. |
| **Google Admin SDK** | The core library for performing the actual user and group management in Workspace. |
| **Google Secret Manager** | Secure handling of the Admin key used for domain delegation. |
| **Google Firestore** | Dynamically stores the AI prompts and the structured FAQ database. |
| **Gemini API** | The AI engine for natural language understanding and semantic search. |

---

## 🔒 Deployment and Security Requirements

### IAM Roles

To enable the bot and Google Cloud services to function, the following roles must be assigned to the relevant Service Accounts (SAs):

#### 1. Primary Execution Service Account (The Bot)

This account runs your application and needs permissions to manage groups, access data, and handle secrets.

| IAM Role | Purpose |
| :--- | :--- |
| **Cloud Datastore User** | Allows read/write access to the Firestore database. |
| **Secret Manager Secret Accessor** | Allows accessing the Admin key stored in Secret Manager. |
| **Service Usage Consumer** | Allows the bot to consume quotas and verify service status. |
| **Service Account Token Creator** | Required for the bot to impersonate its own identity (essential for Domain-Wide Delegation). |
| **Logs Writer** | Grants access to write application logs. |

#### 2. Google-Managed Service Accounts (For Platform and AI Services)

| Service Account | IAM Roles Required |
| :--- | :--- |
| **Compute Engine Default SA** (`[PROJECT_NUMBER]-compute@...`) | **Vertex AI User** |
| **Vertex AI Service Agent** (`service-PROJECT_ID@gcp-sa-aiplatform...`) | **Vertex AI Administrator** |
| **Vertex AI Express SA** (`service-express@[PROJECT_ID].iam.gserviceaccount.com`) | **Vertex AI Platform Express User** |
| **Artifact Registry SA** (`service-PROJECT_ID@containerregistry.iam.gserviceaccount.com`) | **Artifact Registry Writer** (Necessary for deploying container images). |

### Google Workspace Admin Setup (Domain Delegation)

**This is critical for group management functionality.** Before deployment, you must configure the following actions in the Google Workspace Admin Console to grant the Service Account permission to manage users and groups:

1.  **Enable DWD:** Ensure **Domain-Wide Delegation** is enabled in your Workspace environment.
2.  **Delegate API Scopes:** Navigate to Security > Access and data control > API controls > Domain-wide Delegation.
3.  **Add Service Account:** Register your primary Execution Service Account's Client ID.
4.  **Authorize Scopes:** Authorize the required Google Admin SDK scopes (listed in `index.js`) for delegation.

---

## 💾 Firestore Configuration

### FAQ Data Structure

The bot relies on a specific structure where the content is stored as a JSON string within a document.

* **Collection:** `faq`

**Configuration Process**

1.  Write your FAQ content following the JSON array format below.
2.  In the Firestore console, create a collection named `faq`.
3.  Create a new document and add the field **`faq_documentation`**. Paste the complete JSON content as a **String value**.

```json
[
  {
    "id": 1,
    "category": "Access and Passwords",
    "questions": ["How can I reset my password?", "I forgot my key."],
    "keywords": ["reset", "password", "key"],
    "standard_answer": "To reset your password, you must go to the self-service portal...",
    "detailed_steps": ["Visit the company's web portal.", "Click on 'Forgot my password'."]
  }
]
