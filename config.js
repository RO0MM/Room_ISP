/*
  ROOM ISP - CONFIGURACIÓN PÚBLICA
  SOLO valores públicos. Nunca colocar aquí:
  service_role, secret keys, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
  CRON_SECRET, router_token ni enrollment_token permanente.
*/
window.ROOM_ISP_CONFIG = {
  SUPABASE_URL: "https://bhdjvmvehfwiqaqobqsr.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zGZrJpXjY3TGkFcnPDM2hw_In2_5y9B",
  ADMIN_API_URL: "https://bhdjvmvehfwiqaqobqsr.supabase.co/functions/v1/clever-worker",
  SUPERADMIN_API_URL: "https://bhdjvmvehfwiqaqobqsr.supabase.co/functions/v1/bright-action",
  ROUTER_ENROLL_URL: "https://bhdjvmvehfwiqaqobqsr.supabase.co/functions/v1/bright-worker",
  ROUTER_SYNC_URL: "https://bhdjvmvehfwiqaqobqsr.supabase.co/functions/v1/smooth-processor",
  TELEGRAM_BOT_USERNAME: "ROOM_ispp_bot",
  APP_NAME: "ROOM ISP",
  APP_SUBTITLE: "ISP Control Suite",
  CURRENCY: "PEN",
  LOCALE: "es-PE",
  DEFAULT_TIMEZONE: "America/Lima"
};
