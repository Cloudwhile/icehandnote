import type { LocaleCode } from './types';

export interface ProblemDetailsPayload {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problemType: string;
  readonly title: string;
  readonly detail: string;
  readonly meta?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code: string;
    problemType?: string;
    title?: string;
    detail: string;
    meta?: Record<string, unknown>;
  }) {
    super(params.detail || params.title || `HTTP ${params.status}`);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.problemType = params.problemType ?? 'about:blank';
    this.title = params.title ?? `HTTP ${params.status}`;
    this.detail = params.detail;
    this.meta = params.meta;
  }
}

export async function parseApiErrorResponse(res: Response): Promise<ApiError> {
  const status = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  const rawText = await res.text().catch(() => '');

  if (
    contentType.includes('application/problem+json') ||
    contentType.includes('application/json') ||
    rawText.trim().startsWith('{')
  ) {
    try {
      const parsed = JSON.parse(rawText) as ProblemDetailsPayload;
      if (parsed && (parsed.code || parsed.detail || parsed.title)) {
        return new ApiError({
          status: typeof parsed.status === 'number' ? parsed.status : status,
          code: typeof parsed.code === 'string' ? parsed.code : fallbackCodeForStatus(status),
          problemType: parsed.type,
          title: parsed.title,
          detail: parsed.detail ?? parsed.title ?? `HTTP ${status}`,
          meta: parsed.meta,
        });
      }
    } catch {
      // fall through to plain-text fallback
    }
  }

  return new ApiError({
    status,
    code: fallbackCodeForStatus(status),
    detail: rawText.trim() || res.statusText || `HTTP ${status}`,
  });
}

function fallbackCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 429:
      return 'VERIFICATION_CODE_RATE_LIMITED';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

type ErrorCatalog = Record<string, string>;

const ERROR_MESSAGES: Record<LocaleCode, ErrorCatalog> = {
  'zh-CN': {
    BAD_REQUEST: '请求参数有误，请检查填写内容后重试',
    UNAUTHORIZED: '请先登录账号',
    SESSION_EXPIRED: '登录状态已过期，请重新登录',
    FORBIDDEN: '权限不足，无法执行该操作',
    NOT_FOUND: '未找到请求的资源',
    CONFLICT: '操作冲突，请刷新后重试',
    PAYLOAD_TOO_LARGE: '上传内容超出体积限制',
    UNSUPPORTED_MEDIA_TYPE: '不支持的文件格式或媒体类型',
    BAD_GATEWAY: '上游服务连接失败，请稍后重试',
    SERVICE_UNAVAILABLE: '相关服务当前未启用或暂不可用',
    INTERNAL_ERROR: '服务器发生内部错误，请稍后重试',
    INVALID_CREDENTIALS: '账号或密码不正确，请检查后重试',
    ACCOUNT_BANNED: '该账号已被封禁',
    REGISTRATION_DISABLED: '当前站点未开放新用户注册',
    USERNAME_TAKEN: '该用户名已被占用',
    EMAIL_TAKEN: '该邮箱已被其他账号注册',
    INVALID_USERNAME: '用户名需为 2–32 位字母、数字、下划线或连字符',
    INVALID_EMAIL: '请输入有效的邮箱地址',
    PASSWORD_TOO_SHORT: '密码长度至少需要 8 个字符',
    INVALID_CURRENT_PASSWORD: '当前密码不正确',
    RESET_TOKEN_INVALID: '密码重置链接无效或已过期，请重新发起',
    VERIFICATION_CODE_REQUIRED: '请输入邮箱收到的 6 位验证码',
    VERIFICATION_CODE_INVALID: '邮箱验证码不正确或已失效，请检查后重试',
    VERIFICATION_CODE_EXPIRED: '邮箱验证码已过期，请重新获取',
    VERIFICATION_CODE_RATE_LIMITED: '验证码发送过于频繁，请稍后再试',
    OTP_CHALLENGE_INVALID: '登录安全验证会话无效或已失效，请重新登录',
    OTP_CHALLENGE_EXPIRED: '登录安全验证会话已过期，请重新登录',
    SESSION_NOT_FOUND: '该登录会话不存在或已下线',
    SSO_INVALID_SIGNATURE: '外部单点登录签名校验失败',
    DEV_SSO_DISABLED: '开发模式 SSO 模拟器未启用',
    OAUTH_NOT_CONFIGURED: '第三方 OAuth 登录尚未完成配置',
    OAUTH_SESSION_EXPIRED: '第三方授权会话已过期，请重新发起登录',
    OAUTH_TICKET_INVALID: '第三方登录票据无效或已过期',
    OAUTH_ALREADY_BOUND: '该第三方账号已被其他用户绑定',
    UPLOAD_EMPTY: '上传的文件为空',
    UPLOAD_TOO_LARGE: '图片体积超出 10 MB 限制',
    UPLOAD_MISSING_FIELD: '未检测到上传文件',
    MEDIA_NOT_FOUND: '找不到该媒体文件',
    STEP_NOT_FOUND: '文章不存在或已下架',
    TRACK_NOT_FOUND: '找不到指定的专题',
    CHAPTER_NOT_FOUND: '找不到指定的章节',
    TRACK_SLUG_EXISTS: '该专题 Slug 已存在',
    CHAPTER_SLUG_EXISTS: '该章节 Slug 已存在',
    INVALID_SLUG: 'Slug 格式无效（仅允许字母、数字、连字符和下划线）',
    STEP_SAVE_REQUIRED: '请先保存文章再邀请协作者',
    STEP_TAKEN_DOWN: '该文章已被管理员下架，仅可保存为草稿，重新上架请联系管理员',
    STEP_EDIT_FORBIDDEN: '你不是该文章的作者或协作者，无权保存修改',
    STEP_DELETE_FORBIDDEN: '只有文章主作者或管理员可以删除该文章',
    NOTE_CONTENT_EMPTY: '批注内容不能为空',
    TITLE_OR_SLUG_REQUIRED: '标题与文章 Slug 不能为空',
    INVITE_INVALID: '协作邀请链接无效或已过期',
    INVITE_FORBIDDEN: '仅文章创建者或管理员可执行此邀请操作',
    INVITE_TARGET_DELETED: '该邀请关联的文章已被删除',
    COLLABORATOR_FORBIDDEN: '无权管理该文章的协作者',
    CANNOT_MODIFY_SELF: '不能对当前登录管理员自身执行此操作',
    USER_NOT_FOUND: '找不到指定用户',
    SITE_NAME_REQUIRED: '站点名称不能为空',
    INVALID_URL: '地址格式无效，必须以 https:// 或 http:// 开头',
    INVALID_LOGO_URL: 'LOGO 地址无效，必须为已上传地址或 http(s):// 链接',
    MIN_ONE_LOCALE: '至少需要保留一种启用语言',
    STORAGE_URL_REQUIRED: '请填写 PostgreSQL 连接字符串',
    STORAGE_MODE_INVALID: '无效的存储模式',
    STORAGE_CONNECTION_FAILED: 'PostgreSQL 数据库连接失败，请检查地址与权限',
    SMTP_NOT_CONFIGURED: '站点尚未配置邮件服务，请联系管理员协助处理',
    SMTP_SEND_FAILED: '邮件发送失败，请检查 SMTP 配置与凭据',
    TAKEDOWN_REASON_REQUIRED: '请填写文章下架原因',
    UPSTREAM_ERROR: '上游版本服务响应异常，请稍后重试',
    // OAuth redirect query error codes
    oauth_invalid_state: '第三方登录状态校验失败，请重试',
    oauth_missing_state: '缺少第三方登录状态校验信息，请重试',
    oauth_state_mismatch: '第三方登录状态不匹配，请重新登录',
    oauth_expired_state: '第三方登录已超时，请重新发起',
    oauth_missing_code: '第三方未返回授权码',
    oauth_token_exchange_failed: '第三方令牌换取失败，请检查 OAuth 配置',
    oauth_userinfo_failed: '获取第三方用户信息失败',
    oauth_account_banned: '该账号已被封禁，无法登录',
    oauth_account_already_bound: '该第三方账号已被其他站点用户绑定',
  },
  en: {
    BAD_REQUEST: 'Invalid request parameters. Please check your input.',
    UNAUTHORIZED: 'Please sign in to continue.',
    SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
    FORBIDDEN: 'You do not have permission to perform this action.',
    NOT_FOUND: 'The requested resource was not found.',
    CONFLICT: 'A conflict occurred. Please refresh and try again.',
    PAYLOAD_TOO_LARGE: 'The uploaded payload exceeds the maximum allowed size.',
    UNSUPPORTED_MEDIA_TYPE: 'Unsupported file format or media type.',
    BAD_GATEWAY: 'Failed to reach upstream service. Please try again.',
    SERVICE_UNAVAILABLE: 'This service is not enabled or temporarily unavailable.',
    INTERNAL_ERROR: 'An internal server error occurred. Please try again.',
    INVALID_CREDENTIALS: 'Invalid username, email, or password.',
    ACCOUNT_BANNED: 'This account has been suspended.',
    REGISTRATION_DISABLED: 'Public registration is currently disabled.',
    USERNAME_TAKEN: 'This username is already taken.',
    EMAIL_TAKEN: 'This email address is already registered.',
    INVALID_USERNAME: 'Username must be 2–32 characters (letters, digits, _ or -).',
    INVALID_EMAIL: 'Please enter a valid email address.',
    PASSWORD_TOO_SHORT: 'Password must be at least 8 characters long.',
    INVALID_CURRENT_PASSWORD: 'Your current password is incorrect.',
    RESET_TOKEN_INVALID: 'This password reset link is invalid or has expired.',
    VERIFICATION_CODE_REQUIRED: 'Please enter the 6-digit email verification code.',
    VERIFICATION_CODE_INVALID: 'Invalid email verification code. Please check your inbox and try again.',
    VERIFICATION_CODE_EXPIRED: 'This verification code has expired. Please request a new one.',
    VERIFICATION_CODE_RATE_LIMITED: 'Please wait a moment before requesting another verification code.',
    OTP_CHALLENGE_INVALID: 'Verification session is invalid. Please sign in again.',
    OTP_CHALLENGE_EXPIRED: 'Verification session expired. Please sign in again.',
    SESSION_NOT_FOUND: 'Session not found or already signed out.',
    SSO_INVALID_SIGNATURE: 'External SSO signature verification failed.',
    DEV_SSO_DISABLED: 'Dev SSO simulator is disabled.',
    OAUTH_NOT_CONFIGURED: 'OAuth sign-in is not fully configured.',
    OAUTH_SESSION_EXPIRED: 'OAuth authorization session expired. Please sign in again.',
    OAUTH_TICKET_INVALID: 'OAuth login ticket is invalid or has expired.',
    OAUTH_ALREADY_BOUND: 'This OAuth identity is already linked to another account.',
    UPLOAD_EMPTY: 'The uploaded file is empty.',
    UPLOAD_TOO_LARGE: 'Image size exceeds the 10 MB limit.',
    UPLOAD_MISSING_FIELD: 'No file was provided in the upload request.',
    MEDIA_NOT_FOUND: 'Media file not found.',
    STEP_NOT_FOUND: 'Article not found or unavailable.',
    TRACK_NOT_FOUND: 'Track not found.',
    CHAPTER_NOT_FOUND: 'Chapter not found.',
    TRACK_SLUG_EXISTS: 'Track slug already exists.',
    CHAPTER_SLUG_EXISTS: 'Chapter slug already exists.',
    INVALID_SLUG: 'Invalid slug format (use letters, digits, hyphens, or underscores).',
    STEP_SAVE_REQUIRED: 'Save the article before inviting collaborators.',
    STEP_TAKEN_DOWN: 'This article was taken down. Save as draft and ask an administrator to restore it.',
    STEP_EDIT_FORBIDDEN: 'You do not have permission to edit this article.',
    STEP_DELETE_FORBIDDEN: 'Only the article owner or an administrator can delete it.',
    NOTE_CONTENT_EMPTY: 'Margin note content cannot be empty.',
    TITLE_OR_SLUG_REQUIRED: 'Title and article slug are required.',
    INVITE_INVALID: 'This collaboration invite link is invalid or has expired.',
    INVITE_FORBIDDEN: 'Only the article owner or an administrator can manage invitations.',
    INVITE_TARGET_DELETED: 'The invited article no longer exists.',
    COLLABORATOR_FORBIDDEN: 'You do not have permission to manage collaborators.',
    CANNOT_MODIFY_SELF: 'You cannot perform this action on your own administrator account.',
    USER_NOT_FOUND: 'User not found.',
    SITE_NAME_REQUIRED: 'Site name cannot be empty.',
    INVALID_URL: 'URL must start with https:// or http://.',
    INVALID_LOGO_URL: 'Logo URL must be an uploaded path or an http(s):// link.',
    MIN_ONE_LOCALE: 'At least one locale must remain enabled.',
    STORAGE_URL_REQUIRED: 'Please provide a PostgreSQL connection URL.',
    STORAGE_MODE_INVALID: 'Invalid storage backend mode.',
    STORAGE_CONNECTION_FAILED: 'PostgreSQL connection failed. Check the URL and credentials.',
    SMTP_NOT_CONFIGURED: 'Email service is not configured. Please contact an administrator.',
    SMTP_SEND_FAILED: 'Failed to send email. Please check your SMTP settings.',
    TAKEDOWN_REASON_REQUIRED: 'Please enter a takedown reason.',
    UPSTREAM_ERROR: 'Upstream release check failed. Please try again later.',
    oauth_invalid_state: 'OAuth state verification failed. Please retry.',
    oauth_missing_state: 'Missing OAuth state cookie. Please retry.',
    oauth_state_mismatch: 'OAuth state mismatch. Please retry sign-in.',
    oauth_expired_state: 'OAuth sign-in timed out. Please try again.',
    oauth_missing_code: 'OAuth provider did not return an authorization code.',
    oauth_token_exchange_failed: 'OAuth token exchange failed. Check client credentials.',
    oauth_userinfo_failed: 'Failed to fetch user profile from OAuth provider.',
    oauth_account_banned: 'This account has been suspended.',
    oauth_account_already_bound: 'This OAuth identity is already linked to another user.',
  },
  'zh-TW': {
    BAD_REQUEST: '請求參數有誤，請檢查填寫內容後重試',
    UNAUTHORIZED: '請先登入帳號',
    SESSION_EXPIRED: '登入狀態已過期，請重新登入',
    FORBIDDEN: '權限不足，無法執行此操作',
    NOT_FOUND: '找不到請求的資源',
    CONFLICT: '操作發生衝突，請重新整理後重試',
    PAYLOAD_TOO_LARGE: '上傳內容超出體積限制',
    UNSUPPORTED_MEDIA_TYPE: '不支援的檔案格式或媒體類型',
    BAD_GATEWAY: '上游服務連線失敗，請稍後重試',
    SERVICE_UNAVAILABLE: '相關服務目前尚未啟用或暫不可用',
    INTERNAL_ERROR: '伺服器發生內部錯誤，請稍後重試',
    INVALID_CREDENTIALS: '帳號或密碼不正確，請檢查後重試',
    ACCOUNT_BANNED: '此帳號已被停權',
    REGISTRATION_DISABLED: '目前站點未開放新用戶註冊',
    USERNAME_TAKEN: '此用戶名已被使用',
    EMAIL_TAKEN: '此電子郵件已被其他帳號註冊',
    INVALID_USERNAME: '用戶名需為 2–32 位字母、數字、底線或連字號',
    INVALID_EMAIL: '請輸入有效的電子郵件地址',
    PASSWORD_TOO_SHORT: '密碼長度至少需要 8 個字元',
    INVALID_CURRENT_PASSWORD: '目前密碼不正確',
    RESET_TOKEN_INVALID: '密碼重設連結無效或已過期，請重新申請',
    VERIFICATION_CODE_REQUIRED: '請輸入信箱收到的 6 位數驗證碼',
    VERIFICATION_CODE_INVALID: '信箱驗證碼不正確或已失效，請檢查後重試',
    VERIFICATION_CODE_EXPIRED: '信箱驗證碼已過期，請重新取得',
    VERIFICATION_CODE_RATE_LIMITED: '驗證碼寄送過於頻繁，請稍候再試',
    OTP_CHALLENGE_INVALID: '登入安全驗證工作階段無效，請重新登入',
    OTP_CHALLENGE_EXPIRED: '登入安全驗證工作階段已過期，請重新登入',
    SESSION_NOT_FOUND: '此登入工作階段不存在或已登出',
    SSO_INVALID_SIGNATURE: '外部單一登入簽章驗證失敗',
    DEV_SSO_DISABLED: '開發模式 SSO 模擬器未啟用',
    OAUTH_NOT_CONFIGURED: '第三方 OAuth 登入尚未完成設定',
    OAUTH_SESSION_EXPIRED: '第三方授權工作階段已過期，請重新登入',
    OAUTH_TICKET_INVALID: '第三方登入票據無效或已過期',
    OAUTH_ALREADY_BOUND: '此第三方帳號已被其他用戶綁定',
    UPLOAD_EMPTY: '上傳的檔案為空',
    UPLOAD_TOO_LARGE: '圖片大小超出 10 MB 限制',
    UPLOAD_MISSING_FIELD: '未偵測到上傳檔案',
    MEDIA_NOT_FOUND: '找不到此媒體檔案',
    STEP_NOT_FOUND: '文章不存在或已下架',
    TRACK_NOT_FOUND: '找不到指定的專題',
    CHAPTER_NOT_FOUND: '找不到指定的章節',
    TRACK_SLUG_EXISTS: '此專題 Slug 已存在',
    CHAPTER_SLUG_EXISTS: '此章節 Slug 已存在',
    INVALID_SLUG: 'Slug 格式無效（僅允許字母、數字、連字號與底線）',
    STEP_SAVE_REQUIRED: '請先儲存文章再邀請協作者',
    STEP_TAKEN_DOWN: '此文章已被管理員下架，僅可儲存為草稿，重新上架請聯繫管理員',
    STEP_EDIT_FORBIDDEN: '您不是此文章的作者或協作者，無權儲存修改',
    STEP_DELETE_FORBIDDEN: '僅文章主作者或管理員可刪除此文章',
    NOTE_CONTENT_EMPTY: '批註內容不能為空',
    TITLE_OR_SLUG_REQUIRED: '標題與文章 Slug 不能為空',
    INVITE_INVALID: '協作邀請連結無效或已過期',
    INVITE_FORBIDDEN: '僅文章建立者或管理員可執行此邀請操作',
    INVITE_TARGET_DELETED: '此邀請關聯的文章已被刪除',
    COLLABORATOR_FORBIDDEN: '無權管理此文章的協作者',
    CANNOT_MODIFY_SELF: '無法對目前登入中的管理員自身執行此操作',
    USER_NOT_FOUND: '找不到指定用戶',
    SITE_NAME_REQUIRED: '站點名稱不能為空',
    INVALID_URL: '網址格式無效，必須以 https:// 或 http:// 開頭',
    INVALID_LOGO_URL: 'LOGO 網址無效，須為已上傳路徑或 http(s):// 連結',
    MIN_ONE_LOCALE: '至少需要保留一種啟用語言',
    STORAGE_URL_REQUIRED: '請填寫 PostgreSQL 連線字串',
    STORAGE_MODE_INVALID: '無效的儲存模式',
    STORAGE_CONNECTION_FAILED: 'PostgreSQL 資料庫連線失敗，請檢查網址與權限',
    SMTP_NOT_CONFIGURED: '站點尚未設定郵件服務，請聯繫管理員協助處理',
    SMTP_SEND_FAILED: '郵件寄送失敗，請檢查 SMTP 設定與憑證',
    TAKEDOWN_REASON_REQUIRED: '請填寫文章下架原因',
    UPSTREAM_ERROR: '上游版本服務回應異常，請稍後重試',
    oauth_invalid_state: '第三方登入狀態驗證失敗，請重試',
    oauth_missing_state: '缺少第三方登入狀態資訊，請重試',
    oauth_state_mismatch: '第三方登入狀態不符，請重新登入',
    oauth_expired_state: '第三方登入已逾時，請重新發起',
    oauth_missing_code: '第三方未回傳授權碼',
    oauth_token_exchange_failed: '第三方權杖交換失敗，請檢查 OAuth 設定',
    oauth_userinfo_failed: '取得第三方用戶資訊失敗',
    oauth_account_banned: '此帳號已被停權，無法登入',
    oauth_account_already_bound: '此第三方帳號已被其他用戶綁定',
  },
  ja: {
    BAD_REQUEST: 'リクエスト内容が無効です。入力内容を確認してください。',
    UNAUTHORIZED: 'サインインが必要です。',
    SESSION_EXPIRED: 'セッションの有効期限が切れました。再度サインインしてください。',
    FORBIDDEN: 'この操作を実行する権限がありません。',
    NOT_FOUND: '対象のリソースが見つかりませんでした。',
    CONFLICT: '競合が発生しました。ページを更新してやり直してください。',
    PAYLOAD_TOO_LARGE: 'ファイルサイズが上限を超えています。',
    UNSUPPORTED_MEDIA_TYPE: 'サポートされていないファイル形式です。',
    BAD_GATEWAY: '外部サービスとの通信に失敗しました。',
    SERVICE_UNAVAILABLE: 'このサービスは現在有効化されていません。',
    INTERNAL_ERROR: 'サーバーエラーが発生しました。しばらくしてから再試行してください。',
    INVALID_CREDENTIALS: 'ユーザー名・メールアドレスまたはパスワードが正しくありません。',
    ACCOUNT_BANNED: 'このアカウントは停止されています。',
    REGISTRATION_DISABLED: '現在、新規ユーザー登録は停止されています。',
    USERNAME_TAKEN: 'このユーザー名は既に使用されています。',
    EMAIL_TAKEN: 'このメールアドレスは既に登録されています。',
    INVALID_USERNAME: 'ユーザー名は 2〜32 文字の英数字、_、- で入力してください。',
    INVALID_EMAIL: '有効なメールアドレスを入力してください。',
    PASSWORD_TOO_SHORT: 'パスワードは 8 文字以上で入力してください。',
    INVALID_CURRENT_PASSWORD: '現在のパスワードが正しくありません。',
    RESET_TOKEN_INVALID: 'パスワード再設定リンクが無効または期限切れです。',
    VERIFICATION_CODE_REQUIRED: 'メールに届いた 6 桁の確認コードを入力してください。',
    VERIFICATION_CODE_INVALID: '確認コードが正しくないか無効です。再度お試しください。',
    VERIFICATION_CODE_EXPIRED: '確認コードの有効期限が切れました。再送信してください。',
    VERIFICATION_CODE_RATE_LIMITED: '送信間隔が短すぎます。しばらくしてから再送信してください。',
    OTP_CHALLENGE_INVALID: '認証セッションが無効です。もう一度サインインしてください。',
    OTP_CHALLENGE_EXPIRED: '認証セッションの有効期限が切れました。再度サインインしてください。',
    SESSION_NOT_FOUND: '対象のセッションは見つからないか既に終了しています。',
    SSO_INVALID_SIGNATURE: '外部 SSO 署名の検証に失敗しました。',
    DEV_SSO_DISABLED: '開発用 SSO シミュレーターは無効です。',
    OAUTH_NOT_CONFIGURED: 'OAuth ログインの設定が完了していません。',
    OAUTH_SESSION_EXPIRED: 'OAuth 認証セッションの期限が切れました。再度お試しください。',
    OAUTH_TICKET_INVALID: 'OAuth ログインチケットが無効または期限切れです。',
    OAUTH_ALREADY_BOUND: 'この OAuth アカウントは既に別ユーザーに連携されています。',
    UPLOAD_EMPTY: 'アップロードされたファイルが空です。',
    UPLOAD_TOO_LARGE: '画像サイズが 10 MB の上限を超えています。',
    UPLOAD_MISSING_FIELD: 'アップロードファイルが見つかりません。',
    MEDIA_NOT_FOUND: 'メディアファイルが見つかりません。',
    STEP_NOT_FOUND: '記事が見つからないか、公開停止中です。',
    TRACK_NOT_FOUND: 'トラックが見つかりません。',
    CHAPTER_NOT_FOUND: 'チャプターが見つかりません。',
    TRACK_SLUG_EXISTS: 'このトラックスラッグは既に存在します。',
    CHAPTER_SLUG_EXISTS: 'このチャプタースラッグは既に存在します。',
    INVALID_SLUG: 'スラッグ形式が無効です（英数字・ハイフン・アンダースコアのみ）。',
    STEP_SAVE_REQUIRED: '共同執筆者を招待する前に記事を保存してください。',
    STEP_TAKEN_DOWN: 'この記事は管理者により非公開にされています。下書き保存後、管理者へ復旧を依頼してください。',
    STEP_EDIT_FORBIDDEN: 'この記事を編集する権限がありません。',
    STEP_DELETE_FORBIDDEN: '記事の削除は主著者または管理者のみ可能です。',
    NOTE_CONTENT_EMPTY: '余白メモの内容を入力してください。',
    TITLE_OR_SLUG_REQUIRED: 'タイトルと記事スラッグは必須です。',
    INVITE_INVALID: '共同執筆の招待リンクが無効または期限切れです。',
    INVITE_FORBIDDEN: '招待の管理は記事の主著者または管理者のみ可能です。',
    INVITE_TARGET_DELETED: '招待対象の記事は既に削除されています。',
    COLLABORATOR_FORBIDDEN: '共同執筆者を管理する権限がありません。',
    CANNOT_MODIFY_SELF: '現在ログイン中の管理者自身にはこの操作を行えません。',
    USER_NOT_FOUND: '指定されたユーザーが見つかりません。',
    SITE_NAME_REQUIRED: 'サイト名は空にできません。',
    INVALID_URL: 'URL は https:// または http:// で始まる必要があります。',
    INVALID_LOGO_URL: 'ロゴ URL はアップロード済みパスまたは http(s):// である必要があります。',
    MIN_ONE_LOCALE: '少なくとも 1 つの言語を有効にする必要があります。',
    STORAGE_URL_REQUIRED: 'PostgreSQL 接続 URL を入力してください。',
    STORAGE_MODE_INVALID: 'ストレージモードが無効です。',
    STORAGE_CONNECTION_FAILED: 'PostgreSQL への接続に失敗しました。URL と認証情報を確認してください。',
    SMTP_NOT_CONFIGURED: 'メール送信サービスが設定されていません。管理者にお問い合わせください。',
    SMTP_SEND_FAILED: 'メール送信に失敗しました。SMTP 設定を確認してください。',
    TAKEDOWN_REASON_REQUIRED: '公開停止の理由を入力してください。',
    UPSTREAM_ERROR: '更新確認の通信に失敗しました。',
    oauth_invalid_state: 'OAuth 状態の検証に失敗しました。もう一度お試しください。',
    oauth_missing_state: 'OAuth 状態情報が不足しています。もう一度お試しください。',
    oauth_state_mismatch: 'OAuth 状態が一致しません。再度サインインしてください。',
    oauth_expired_state: 'OAuth 認証がタイムアウトしました。再度お試しください。',
    oauth_missing_code: 'OAuth プロバイダーから認可コードが返されませんでした。',
    oauth_token_exchange_failed: 'OAuth トークン交換に失敗しました。設定を確認してください。',
    oauth_userinfo_failed: 'OAuth プロバイダーからプロフィールを取得できませんでした。',
    oauth_account_banned: 'このアカウントは停止されているためログインできません。',
    oauth_account_already_bound: 'この OAuth アカウントは既に別のユーザーと連携されています。',
  },
};

export function formatOAuthRedirectError(errorCode: string, locale: LocaleCode): string {
  const dict = ERROR_MESSAGES[locale] ?? ERROR_MESSAGES.en;
  const key = `oauth_${errorCode.trim().toLowerCase()}`;
  return dict[key] ?? ERROR_MESSAGES.en[key] ?? dict.OAUTH_SESSION_EXPIRED;
}

export function resolveLocalizedError(
  err: unknown,
  locale: LocaleCode,
  fallbackMessage?: string,
): string {
  const dict = ERROR_MESSAGES[locale] ?? ERROR_MESSAGES.en;

  if (err instanceof ApiError) {
    const base = dict[err.code] ?? ERROR_MESSAGES.en[err.code] ?? err.detail;
    const retrySecs =
      err.meta && typeof err.meta.retry_after_secs === 'number'
        ? Math.max(1, Math.round(err.meta.retry_after_secs))
        : 0;
    if (err.code === 'VERIFICATION_CODE_RATE_LIMITED' && retrySecs > 0) {
      return `${base} (${retrySecs}s)`;
    }
    const reason =
      err.meta && typeof err.meta.reason === 'string' ? err.meta.reason.trim() : '';
    if (reason) {
      return `${base}: ${reason}`;
    }
    return base;
  }

  if (typeof err === 'string' && err.trim()) {
    const mapped = dict[err.trim()];
    return mapped ?? err;
  }

  if (err instanceof Error) {
    if (err.message && dict[err.message]) {
      return dict[err.message];
    }
    return fallbackMessage ?? err.message ?? dict.INTERNAL_ERROR;
  }

  return fallbackMessage ?? dict.INTERNAL_ERROR;
}
