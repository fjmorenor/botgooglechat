# Bot Omega: Google Workspace Group Management Agent

Bot Omega is a resilient and powerful chat tool designed to simplify and automate critical administrative tasks for **Google Workspace Groups** (such as adding/removing members and changing roles). It also serves as a technical assistant, providing instant answers to frequently asked questions (FAQs) using Artificial Intelligence.

The project is built on core Google Cloud technologies, including the Admin SDK, Secret Manager for secure credential management, and the Gemini API for natural language understanding.

---

## Core Features

This bot offers powerful and secure management of your Workspace environment:

* **Natural Language Administration:** Users can request actions using everyday phrases (e.g., "add user@ to group.test@") thanks to intent recognition powered by the **Gemini AI**.
* **Credential Security:** Sensitive service account keys are never stored in code or exposed environment variables. They are loaded securely at runtime via **Google Secret Manager (GSM)**.
* **Flexible Resolution:** The bot can find users and groups using full emails, partial emails, or display names (e.g., "Juan Pérez").
* **Dual FAQ System:** For support queries, the bot uses ultra-fast **Deterministic Search** against a Firestore knowledge base and falls back to **Gemini's semantic search** if required.
* **Permission Control:** Strict access rules are applied. Only Global Admins, Owners, or designated Managers can modify group memberships.

---

## Structure and Technology

The bot is built on a Node.js architecture ready for serverless deployment (such as Google Cloud Run):

| Technology | Purpose |
| :--- | :--- |
| **Node.js / Express** | Runtime environment and web server managing Google Chat events. |
| **Google Admin SDK** | Primary tool for managing users and groups within Google Workspace. |
| **Google Secret Manager** | Securely stores and retrieves the Admin SDK Service Account credentials. |
| **Google Firestore** | Dynamically loads AI prompts and the structured FAQ knowledge base. |
| **Gemini API** | Used for Natural Language Understanding (NLU) and semantic search support. |
| **Google Chat API** | Primary communication interface with the platform. |

---

## 🚀 Setup and Deployment

### IAM Requirements (Necessary Roles)

To deploy and run the bot successfully, you must configure specific **Identity and Access Management (IAM)** roles for different Service Accounts (SAs) in your Google Cloud project.

#### 1. Primary Execution Service Account (Your Bot)

This account runs your application (e.g., in Cloud Run) and needs permissions to manage groups, access data, and handle secrets.

| IAM Role | Purpose |
| :--- | :--- |
| **Cloud Datastore User** | Allows read/write access to data in the Firestore database (`databasechat`). |
| **Secret Manager Secret Accessor** | Allows access to the Admin SDK key stored in Secret Manager. |
| **Service Usage Consumer** | Allows the bot to consume quotas and verify service status. |
| **Service Account Token Creator** | Required if the bot needs to impersonate its own identity (essential for DWD). |
| **Logs Writer** | Grants access to write application logs (fundamental for debugging). |

#### 2. Google-Managed Service Accounts (For Platform and AI Services)

These are Google-managed accounts that require permissions to run specific services used by the project. You must assign these roles manually in the **IAM & Admin** console.

| Service Account | IAM Roles Required |
| :--- | :--- |
| **Compute Engine Default SA** (`[PROJECT_NUMBER]-compute@...`) | **Vertex AI User** |
| **Vertex AI Service Agent** (`service-PROJECT_ID@gcp-sa-aiplatform...`) | **Vertex AI Administrator** |
| **Vertex AI Express SA** (`service-express@[PROJECT_ID].iam.gserviceaccount.com`) | **Vertex AI Platform Express User** |
| **Artifact Registry SA** (`service-PROJECT_ID@containerregistry.iam.gserviceaccount.com`) | **Artifact Registry Writer** (Necessary for deploying container images). |

### Configuration Steps

1.  **Secret Manager:** Store the Admin SDK Service Account JSON key in Secret Manager.
2.  **Environment Variables (`.env`):** Define the required variables (like `GCP_PROJECT_ID`, `DOMAIN`, `GEMINI_API_KEY`, etc.) in your local `.env` file.
3.  **Local Installation:**
    ```bash
    git clone [https://github.com/fjmorenor/botgooglechat.git](https://github.com/fjmorenor/botgooglechat.git)
    cd botgooglechat
    npm install
    ```

---

## 💬 Usage Examples

Users can interact in Google Chat using the following commands:

| Action | Description | Quick Example |
| :--- | :--- | :--- |
| **Add** | Adds users to a group. | \`/add user@ to group.test@\` |
| **Remove** | Removes users from a group. | \`/remove user@ from group.test@\` |
| **Manager** | Promotes a member to Manager role. | \`/make user@ manager of group@\` |
| **Members** | Displays all members of the group. | \`/members support@\` |
| **Leave** | Removes yourself from the group. | \`/leave office.group@\` |
| **MyGroups** | Displays groups you belong to. | \`/mygroups\` |
| **Request Manager** | Formal request for Manager permissions. | \`/request manager of group.test@\` |

---

## Security Notice

This repository uses a `.gitignore` file to permanently exclude sensitive files like:
* `*.tfvars` (Terraform variable files containing local paths or secrets).
* `*.tfstate` (Terraform state files).
* `.env` (Environment variable files).

Since the Git history has been thoroughly cleaned, the code is safe to be made public.
