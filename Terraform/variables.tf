variable "project" {
  description = "ID del proyecto de GCP"
  type        = string
  }

variable "region" {
  description = "Region for GCP resources"
  type        = string
  default     = "europe-west1"
}

variable "credentials_file" {
  description = "Path to the service account JSON key for Terraform"
  type        = string
  
}

variable "gcp_apis" {
  description = "List of GCP APIs to enable"
  type        = list(string)
  default     = [
    "chat.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "dataproc.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "gmail.googleapis.com"
  ]
}

variable "omegaai_roles" {
  description = "Roles for the bot service account"
  type        = list(string)
  default     = [
    "roles/datastore.user",
    "roles/secretmanager.secretAccessor",
    "roles/secretmanager.viewer",
    "roles/iam.serviceAccountTokenCreator",
    "roles/serviceusage.consumer",
    "roles/aiplatform.user"
  ]
}
