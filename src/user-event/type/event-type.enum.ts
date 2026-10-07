export enum EventType {
  // 🔴 Business / Monetization
  PURCHASE = 'purchase',
  VIP_ACTIVATED = 'vip_activated',
  VIP_EXPIRED = 'vip_expired',
  CREDITS_SPENT = 'credits_spent',
  CREDITS_GRANTED = 'credits_granted',
  REFUND_REQUEST = 'refund_request',
  WALLET_CHARGED = 'wallet_charged',
  WALLET_DEBITED = 'wallet_debited',
  PAYMENT_CONFIRMED = 'payment_confirmed',
  PAYMENT_CREATED = 'payment_created',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_EXPIRED = 'payment_expired',

  // 🟠 Core Engagement / Retention
  APP_OPEN = 'app_open',
  LOGIN = 'login',
  LOGOUT = 'logout',
  PROFILE_VIEW = 'profile_view',
  LIKE = 'like',
  SUPERLIKE = 'superlike',
  SKIP = 'skip',
  MATCH = 'match',
  MESSAGE_SENT = 'message_sent',
  MESSAGE_REPORTED = 'message_reported',
  MESSAGE_DELETED = 'message_deleted',
  USER_AUTO_BLOCKED = 'user_auto_blocked',
  USER_VIOLATION = 'user_violation',
  VIP_VIEW = 'vip_view',
  REPEAT_VIEWER = 'repeat_viewer',
  GUIDANCE_GENERATED = 'guidance_generated',
  GUIDANCE_SHOWN = 'guidance_shown',
  PHASE_OPTIMIZATION_PLAN = 'phase_optimization_plan',
  PHASE_UPGRADED = 'phase_upgraded',

  // عکس و پروفایل
  PHOTO_UPLOAD = 'photo_upload',
  PHOTO_DELETE = 'photo_delete',
  PHOTO_REORDER = 'photo_reorder',
  PROFILE_UPDATE_PHOTO_MAIN = 'profile_update_photo_main',
  PROFILE_UPDATE = 'profile_update',

  // 🟡 Safety / Abuse / Security
  USER_REPORTED = 'user_reported',
  REPORT_CONFIRMED = 'report_confirmed',
  USER_BLOCKED = 'user_blocked',
  USER_UNBLOCKED = 'user_unblocked',
  PASSWORD_CHANGE = 'password_change',
  PHONE_CHANGE = 'phone_change',
  ACCOUNT_DEACTIVATE = 'account_deactivate',
  ACCOUNT_DELETE_REQUEST = 'account_delete_request',

  // Ticket
  TICKET_FEEDBACK = 'ticket_feedback',
  TICKET_CREATED = 'ticket_created',

  // 🟡 AI / Assistant
  AI_SUGGESTION_SHOWN = 'ai_suggestion_shown',
  AI_SUGGESTION_ACCEPTED = 'ai_suggestion_accepted',
  AI_CHAT_STARTED = 'ai_chat_started',
  AI_IMAGE_GENERATED = 'ai_image_generated',
  AI_FEEDBACK_SUBMITTED = 'ai_feedback_submitted',
  AI_IMAGE_UPLOADED = 'ai_image_upload',

  // 🟡 Notification
  NOTIFICATION_OPENED = 'notification_opened',
  NOTIFICATION_CLICKED = 'notification_clicked',

  // Feed Events
  BOOST_USED = 'boost_used',
  BOOST_EXPIRED = 'boost_expired',

  // تبلیغات
  PROMOTION_SHOWN = 'promotion_shown',
  PROMOTION_CLICKED = 'promotion_clicked',
  PROMOTION_DISMISSED = 'promotion_dismissed',
  FEED_SHOWN = 'feed_shown',
  COLD_FEED_SHOWN = 'cold_feed_shown',
  PAYMENT_INITIATED = 'payment_initiated',
  USER_REGISTERED = 'user_registered',
}
