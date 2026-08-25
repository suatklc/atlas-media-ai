const AUTH_ERROR_CODES: Record<string, string> = {
  over_email_send_rate_limit:
    "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.",
  email_address_invalid: "Geçerli bir e-posta adresi girin.",
  email_address_not_authorized:
    "Bu e-posta adresine şifre sıfırlama bağlantısı gönderilemiyor.",
  email_provider_disabled:
    "E-posta ile şifre sıfırlama şu anda kullanılamıyor.",
};

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "invalid login credentials": "E-posta veya şifre hatalı.",
  "email not confirmed": "E-posta adresiniz henüz doğrulanmadı.",
  "user already registered": "Bu e-posta adresi zaten kayıtlı.",
  "token has expired or is invalid": "Kod süresi doldu veya geçersiz.",
  "email rate limit exceeded":
    "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.",
  "auth session missing!":
    "Oturumunuzun süresi doldu. Lütfen yeni bir şifre sıfırlama bağlantısı isteyin.",
  "new password should be different from the old password.":
    "Yeni şifre eski şifrenizle aynı olamaz.",
};

export function translateAuthError(message: string, code?: string): string {
  if (code && AUTH_ERROR_CODES[code]) {
    return AUTH_ERROR_CODES[code];
  }

  return (
    AUTH_ERROR_MESSAGES[message.trim().toLocaleLowerCase("en-US")] ??
    "Bir hata oluştu. Lütfen tekrar deneyin."
  );
}
