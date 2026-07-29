const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "E-posta veya şifre hatalı.",
  "Email not confirmed": "E-posta adresiniz henüz doğrulanmadı.",
  "User already registered": "Bu e-posta adresi zaten kayıtlı.",
  "Token has expired or is invalid": "Kod süresi doldu veya geçersiz.",
  "Email rate limit exceeded": "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.",
};

export function translateAuthError(message: string): string {
  return AUTH_ERROR_MESSAGES[message] ?? "Bir hata oluştu. Lütfen tekrar deneyin.";
}
