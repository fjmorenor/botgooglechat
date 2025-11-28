resource "google_service_account" "cuentaservicioomegaai" {
  account_id   = "cuentaservicioomegaai"
  display_name = "Cuenta de servicio para Omega AI"
  project      = var.project
}

resource "google_project_iam_member" "cuentaservicioomegaai_datastoredata" {
  project = var.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cuentaservicioomegaai.email}"
}

resource "google_project_iam_member" "cuentaservicioomegaai_pubsubpublisher" {
  project = var.project
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.cuentaservicioomegaai.email}"
}

resource "google_project_service" "enable_apis" {
  for_each = toset(var.gcp_apis)

  project = var.project
  service = each.value
  disable_on_destroy = false
}

resource "google_firestore_database" "defaultbot_db" {
  name        = "(default)"
  project     = var.project
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}
