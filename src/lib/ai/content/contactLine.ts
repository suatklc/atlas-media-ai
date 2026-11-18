import type { ContactChannels } from "../context/businessProfile";

// Contact line (Atlas goal: owners reach the advisor): the business's own
// existing channels from the profile — WhatsApp and the request form — as
// one neutral line, built deterministically (the model never writes or
// invents a contact address) and free of any promise. null when the
// profile has no channel.
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function buildContactLine(contact: ContactChannels | undefined): string | null {
  const parts = [
    contact?.whatsappUrl ? `WhatsApp: ${displayUrl(contact.whatsappUrl)}` : null,
    contact?.leadFormUrl ? `Talep formu: ${displayUrl(contact.leadFormUrl)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `İletişim — ${parts.join(" · ")}` : null;
}
