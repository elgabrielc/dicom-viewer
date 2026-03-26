use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "health.divergent.dicomviewer";
const ACCESS_TOKEN_KEY: &str = "access_token";
const REFRESH_TOKEN_KEY: &str = "refresh_token";
const USER_EMAIL_KEY: &str = "user_email";
const USER_NAME_KEY: &str = "user_name";

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SecureAuthState {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
}

fn entry_for(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, key).map_err(|error| error.to_string())
}

fn read_value(key: &str) -> Result<Option<String>, String> {
    let entry = entry_for(key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_value(key: &str, value: Option<&str>) -> Result<(), String> {
    let entry = entry_for(key)?;
    match value {
        Some(raw) if !raw.is_empty() => entry.set_password(raw).map_err(|error| error.to_string()),
        _ => match entry.delete_credential() {
            Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

#[tauri::command]
pub fn load_secure_auth_state() -> Result<SecureAuthState, String> {
    Ok(SecureAuthState {
        access_token: read_value(ACCESS_TOKEN_KEY)?,
        refresh_token: read_value(REFRESH_TOKEN_KEY)?,
        user_email: read_value(USER_EMAIL_KEY)?,
        user_name: read_value(USER_NAME_KEY)?,
    })
}

#[tauri::command]
pub fn store_secure_auth_state(state: SecureAuthState) -> Result<bool, String> {
    write_value(ACCESS_TOKEN_KEY, state.access_token.as_deref())?;
    write_value(REFRESH_TOKEN_KEY, state.refresh_token.as_deref())?;
    write_value(USER_EMAIL_KEY, state.user_email.as_deref())?;
    write_value(USER_NAME_KEY, state.user_name.as_deref())?;
    Ok(true)
}

#[tauri::command]
pub fn clear_secure_auth_state() -> Result<bool, String> {
    write_value(ACCESS_TOKEN_KEY, None)?;
    write_value(REFRESH_TOKEN_KEY, None)?;
    write_value(USER_EMAIL_KEY, None)?;
    write_value(USER_NAME_KEY, None)?;
    Ok(true)
}
