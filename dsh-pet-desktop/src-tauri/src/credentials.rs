//! API Key 安全存储：Windows Credential Manager。
//!
//! 配置文件中只保留非敏感字段；密钥在首次启动时从旧版明文配置迁移到
//! Credential Manager，随后从内存读取供 LLM 调用使用。

/// Credential Manager target 名称。使用固定前缀 + 逻辑 id，便于升级/清理。
pub fn target(kind: &str, id: &str) -> String {
    let clean: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .take(120)
        .collect();
    format!("dsh-pet-desktop:{kind}:{clean}")
}

#[cfg(windows)]
mod platform {
    use std::io::Error;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    use winapi::shared::minwindef::DWORD;
    use winapi::um::wincred::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(once(0)).collect()
    }

    pub fn get(name: &str) -> Result<Option<String>, String> {
        let target = wide(name);
        let mut ptr: *mut CREDENTIALW = null_mut();
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) };
        if ok == 0 {
            let err = Error::last_os_error();
            // ERROR_NOT_FOUND = 1168
            if err.raw_os_error() == Some(1168) {
                return Ok(None);
            }
            return Err(format!("读取 Windows 凭据失败：{err}"));
        }
        if ptr.is_null() {
            return Ok(None);
        }
        let value = unsafe {
            let cred = &*ptr;
            let bytes = std::slice::from_raw_parts(
                cred.CredentialBlob,
                cred.CredentialBlobSize as usize,
            );
            let text = String::from_utf8(bytes.to_vec()).ok();
            CredFree(ptr as *mut _);
            text
        };
        Ok(value)
    }

    pub fn set(name: &str, secret: &str) -> Result<(), String> {
        if secret.is_empty() {
            return delete(name);
        }
        let mut target = wide(name);
        let mut blob = secret.as_bytes().to_vec();
        let mut cred: CREDENTIALW = unsafe { std::mem::zeroed() };
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = target.as_mut_ptr();
        cred.CredentialBlobSize = blob.len() as DWORD;
        cred.CredentialBlob = blob.as_mut_ptr();
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        let ok = unsafe { CredWriteW(&mut cred, 0) };
        if ok == 0 {
            return Err(format!(
                "写入 Windows 凭据失败：{}",
                Error::last_os_error()
            ));
        }
        Ok(())
    }

    pub fn delete(name: &str) -> Result<(), String> {
        let target = wide(name);
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let err = Error::last_os_error();
            if err.raw_os_error() == Some(1168) {
                return Ok(());
            }
            return Err(format!("删除 Windows 凭据失败：{err}"));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn get(_name: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn set(_name: &str, _secret: &str) -> Result<(), String> {
        Err("当前平台尚未实现系统凭据存储".into())
    }
    pub fn delete(_name: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn get(kind: &str, id: &str) -> Result<Option<String>, String> {
    platform::get(&target(kind, id))
}

pub fn set(kind: &str, id: &str, secret: &str) -> Result<(), String> {
    platform::set(&target(kind, id), secret)
}

pub fn delete(kind: &str, id: &str) -> Result<(), String> {
    platform::delete(&target(kind, id))
}

