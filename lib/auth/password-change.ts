// Password change responses shared by the browser and the server.

/** Sent with a 401 when the current password does not match. */
export const PASSWORD_CHANGE_WRONG_PASSWORD = "Invalid credentials"
/** Sent with a 503 when the password changed but this browser was signed out. */
export const PASSWORD_CHANGED_SIGNED_OUT =
  "Password changed but sign-in failed. Please sign in."
