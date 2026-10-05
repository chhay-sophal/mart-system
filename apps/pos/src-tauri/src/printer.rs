//! Raw receipt printing (ESC/POS). The frontend renders the receipt and
//! encodes the printer commands; this only delivers the bytes, either through
//! the Windows print spooler as a RAW job (any installed printer: USB, LAN
//! port, shared) or straight to a network printer's raw port
//! (`tcp:HOST[:PORT]`, port 9100 by default).

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const TCP_PREFIX: &str = "tcp:";
const TCP_DEFAULT_PORT: u16 = 9100;
const TCP_TIMEOUT: Duration = Duration::from_secs(5);

/// Names of the printers installed on this machine.
#[tauri::command]
pub async fn list_printers() -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(spooler::list)
    .await
    .map_err(|e| e.to_string())?
}

/// Sends `data` to `printer` unchanged.
#[tauri::command]
pub async fn print_raw(printer: String, data: Vec<u8>) -> Result<(), String> {
  let printer = printer.trim().to_string();
  if printer.is_empty() {
    return Err("No receipt printer selected".into());
  }
  tauri::async_runtime::spawn_blocking(move || match printer.strip_prefix(TCP_PREFIX) {
    Some(address) => send_tcp(address.trim(), &data),
    None => spooler::write_raw(&printer, &data),
  })
  .await
  .map_err(|e| e.to_string())?
}

fn send_tcp(address: &str, data: &[u8]) -> Result<(), String> {
  let target = if address.contains(':') {
    address.to_string()
  } else {
    format!("{address}:{TCP_DEFAULT_PORT}")
  };
  let socket = target
    .to_socket_addrs()
    .map_err(|e| format!("{target}: {e}"))?
    .next()
    .ok_or_else(|| format!("{target}: address not found"))?;
  let mut stream =
    TcpStream::connect_timeout(&socket, TCP_TIMEOUT).map_err(|e| format!("{target}: {e}"))?;
  stream.set_write_timeout(Some(TCP_TIMEOUT)).map_err(|e| e.to_string())?;
  stream.write_all(data).map_err(|e| format!("{target}: {e}"))?;
  stream.flush().map_err(|e| format!("{target}: {e}"))
}

#[cfg(windows)]
mod spooler {
  use std::ffi::c_void;
  use std::io::Error;
  use std::ptr::{null, null_mut};

  type Handle = *mut c_void;

  #[repr(C)]
  struct DocInfo1W {
    doc_name: *const u16,
    output_file: *const u16,
    datatype: *const u16,
  }

  #[repr(C)]
  struct PrinterInfo4W {
    printer_name: *mut u16,
    server_name: *mut u16,
    attributes: u32,
  }

  const PRINTER_ENUM_LOCAL: u32 = 0x2;
  const PRINTER_ENUM_CONNECTIONS: u32 = 0x4;

  #[link(name = "winspool")]
  extern "system" {
    fn OpenPrinterW(name: *const u16, printer: *mut Handle, defaults: *const c_void) -> i32;
    fn ClosePrinter(printer: Handle) -> i32;
    fn StartDocPrinterW(printer: Handle, level: u32, doc_info: *const DocInfo1W) -> u32;
    fn EndDocPrinter(printer: Handle) -> i32;
    fn StartPagePrinter(printer: Handle) -> i32;
    fn EndPagePrinter(printer: Handle) -> i32;
    fn WritePrinter(printer: Handle, buf: *const c_void, len: u32, written: *mut u32) -> i32;
    fn EnumPrintersW(
      flags: u32,
      name: *const u16,
      level: u32,
      buf: *mut u8,
      len: u32,
      needed: *mut u32,
      returned: *mut u32,
    ) -> i32;
  }

  fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
  }

  unsafe fn from_wide(p: *const u16) -> String {
    if p.is_null() {
      return String::new();
    }
    let len = (0..).take_while(|&i| *p.add(i) != 0).count();
    String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
  }

  fn last_error(what: &str) -> String {
    format!("{what}: {}", Error::last_os_error())
  }

  pub fn list() -> Result<Vec<String>, String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    unsafe {
      // First call only reports the buffer size needed.
      EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut count);
      if needed == 0 {
        return Ok(Vec::new());
      }
      // u64 storage keeps the PRINTER_INFO_4W records properly aligned.
      let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
      if EnumPrintersW(flags, null(), 4, buf.as_mut_ptr().cast(), needed, &mut needed, &mut count) == 0 {
        return Err(last_error("Listing printers failed"));
      }
      let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PrinterInfo4W, count as usize);
      Ok(infos.iter().map(|info| from_wide(info.printer_name)).collect())
    }
  }

  pub fn write_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    let name = wide(printer);
    let doc_name = wide("Receipt");
    let datatype = wide("RAW");
    let mut handle: Handle = null_mut();
    unsafe {
      if OpenPrinterW(name.as_ptr(), &mut handle, null()) == 0 {
        return Err(last_error(&format!("Printer \"{printer}\"")));
      }
      let doc = DocInfo1W { doc_name: doc_name.as_ptr(), output_file: null(), datatype: datatype.as_ptr() };
      let result = if StartDocPrinterW(handle, 1, &doc) == 0 {
        Err(last_error("Starting the print job failed"))
      } else {
        let mut written = 0u32;
        let page_ok = StartPagePrinter(handle) != 0;
        let write_ok = page_ok
          && WritePrinter(handle, data.as_ptr().cast(), data.len() as u32, &mut written) != 0
          && written as usize == data.len();
        let result = if write_ok { Ok(()) } else { Err(last_error("Sending to the printer failed")) };
        if page_ok {
          EndPagePrinter(handle);
        }
        EndDocPrinter(handle);
        result
      };
      ClosePrinter(handle);
      result
    }
  }
}

#[cfg(not(windows))]
mod spooler {
  pub fn list() -> Result<Vec<String>, String> {
    Ok(Vec::new())
  }

  pub fn write_raw(_printer: &str, _data: &[u8]) -> Result<(), String> {
    Err("Installed printers are only supported on Windows; use tcp:HOST for a network printer".into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Read;
  use std::net::TcpListener;

  #[test]
  fn sends_bytes_to_a_network_printer() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let reader = std::thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      let mut received = Vec::new();
      socket.read_to_end(&mut received).unwrap();
      received
    });
    send_tcp(&address, b"\x1b@hello").unwrap();
    assert_eq!(reader.join().unwrap(), b"\x1b@hello");
  }

  #[test]
  fn lists_installed_printers() {
    let printers = spooler::list().unwrap();
    println!("{printers:?}");
  }
}
