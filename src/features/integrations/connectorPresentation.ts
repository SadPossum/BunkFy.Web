export function connectorLabel(type: string): string {
  switch (type) {
    case "imap.reservation-json": return "Reservation email inbox";
    case "json.file-drop": return "Reservation file import";
    case "fake.http": return "Test HTTP source (development)";
    default: return `Custom connector (${type})`;
  }
}

export function connectorDescription(type: string): string {
  switch (type) {
    case "imap.reservation-json": return "Import supported reservation JSON attachments from a prepared IMAP mailbox.";
    case "json.file-drop": return "Import reservation JSON files from a folder prepared by your administrator.";
    case "fake.http": return "A synthetic HTTP source for development and integration tests. It is not a booking provider.";
    default: return "Use the setup details supplied for this connector by your administrator.";
  }
}

export function isDevelopmentConnector(type: string): boolean {
  return type === "fake.http";
}
