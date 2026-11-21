import type { LocaleCode } from './types';

export interface Rc3Messages {
  auth: {
    accountRoleLabel: string;
    roleReader: string;
    roleAuthor: string;
    roleReaderHint: string;
    roleAuthorHint: string;
    forgotPasswordLink: string;
    forgotPasswordTitle: string;
    forgotPasswordDesc: string;
    sendResetBtn: string;
    sendingResetBtn: string;
    resetEmailSentMsg: string;
    backToSignIn: string;
    resetPasswordTitle: string;
    newPasswordLabel: string;
    confirmPasswordLabel: string;
    passwordMismatchMsg: string;
    resetSubmitBtn: string;
    resetSuccessMsg: string;
    onboardingTitle: (provider: string) => string;
    onboardingRegisterTab: string;
    onboardingBindTab: string;
    onboardingBindDesc: string;
    onboardingBindBtn: string;
    onboardingCreateBtn: string;
    onboardingAvatarLabel: string;
    oauthBoundSuccessMsg: string;
    signedInWelcomeMsg: (name: string) => string;
    registeredWelcomeMsg: (name: string) => string;
    signedOutMsg: string;
    collabAcceptedMsg: string;
    collabLoginRequiredMsg: string;
    verificationCodeLabel: string;
    verificationCodePlaceholder: string;
    sendCodeBtn: string;
    sendingCodeBtn: string;
    resendCodeCountdown: (seconds: number) => string;
    codeSentToast: (email: string) => string;
    backToHome: string;
    authStepAccount: string;
    authStepEmail: string;
    authStepVerifyOtp: string;
    authStepNewPassword: string;
    continueToOtpBtn: string;
    verifyOtpContinueBtn: string;
    editDetailsBackBtn: string;
    changeEmailBtn: string;
    resendOtpBtn: string;
    otpInputAria: string;
    otpSentSubtitle: (target: string) => string;
    resetStep2Desc: (target: string) => string;
    resetStep3VerifiedBadge: string;
    verifyAndSignInBtn: string;
    verifyAndRegisterBtn: string;
    anomalyTitle: string;
    anomalyDescNewIp: string;
    anomalyDescNewDevice: string;
    anomalyDescBoth: string;
    anomalyIpLabel: string;
    anomalyDeviceLabel: string;
    resetOtpHint: string;
    haveResetCodeBtn: string;
    loginSubtitle: string;
    registerSubtitle: string;
    noAccountPrompt: string;
    goToRegisterLink: string;
    hasAccountPrompt: string;
    goToLoginLink: string;
    passwordToggleWarning: string;
    passwordRuleHint: string;
    usernameRuleHint: string;
    usernameChecking: string;
    usernameAvailable: string;
    usernameTaken: string;
    usernameInvalidFormat: string;
    pwStrengthLabel: string;
    pwStrengthIdle: string;
    pwStrengthWeak: string;
    pwStrengthFair: string;
    pwStrengthGood: string;
    pwStrengthStrong: string;
    pwStrengthAdvisory: string;
    securityFooterNote: string;
    stepProgressAria: string;
    errorPrefixLabel: string;
    errIdentifierRequired: string;
    errUsernameInvalid: string;
    errEmailInvalid: string;
    errPasswordLength: string;
    errOtpLength: string;
  };
  profile: {
    menuItem: string;
    title: string;
    tabProfile: string;
    tabSecurity: string;
    tabSessions: string;
    sessionsTitle: string;
    sessionsDesc: string;
    sessionsEmpty: string;
    sessionCurrentBadge: string;
    sessionIpLabel: string;
    sessionLastSeenLabel: string;
    sessionCreatedLabel: string;
    sessionRevokeBtn: string;
    sessionRevokeOthersBtn: string;
    sessionRevokedMsg: string;
    sessionOthersRevokedMsg: (count: number) => string;
    displayNameLabel: string;
    bioLabel: string;
    bioPlaceholder: string;
    avatarSourceLabel: string;
    avatarDefault: string;
    avatarGravatar: string;
    avatarOAuth: string;
    avatarUpload: string;
    uploadAvatarBtn: string;
    uploadingAvatarBtn: string;
    saveProfileBtn: string;
    savingProfileBtn: string;
    profileSavedMsg: string;
    oauthLinkTitle: string;
    oauthLinkedBadge: (provider: string) => string;
    oauthNotLinkedText: string;
    oauthBindBtn: (provider: string) => string;
    changePasswordTitle: string;
    currentPasswordLabel: string;
    newPasswordLabel: string;
    confirmPasswordLabel: string;
    changePasswordBtn: string;
    changingPasswordBtn: string;
    passwordChangedMsg: string;
  };
  settings: {
    allowAuthorRegistrationLabel: string;
    gravatarBaseUrlLabel: string;
    gravatarBaseUrlPlaceholder: string;
    smtpGroup: string;
    smtpEnabledLabel: string;
    smtpHostLabel: string;
    smtpPortLabel: string;
    smtpEncryptionLabel: string;
    smtpEncTls: string;
    smtpEncStarttls: string;
    smtpEncNone: string;
    smtpUsernameLabel: string;
    smtpPasswordLabel: string;
    smtpPasswordSavedBadge: string;
    smtpClearPasswordBtn: string;
    smtpFromNameLabel: string;
    smtpFromEmailLabel: string;
    smtpEmailFooterLabel: string;
    smtpEmailFooterPlaceholder: string;
    smtpSaveBtn: string;
    smtpSavingBtn: string;
    smtpSavedMsg: string;
    smtpTestEmailLabel: string;
    smtpTestBtn: string;
    smtpTestingBtn: string;
    smtpTestSentMsg: string;
    smtpTemplatesToggle: string;
    smtpRegisterCodeTab: string;
    smtpLoginAnomalyTab: string;
    smtpInviteTab: string;
    smtpResetTab: string;
    smtpTakedownTab: string;
    smtpRegisterSubjectLabel: string;
    smtpRegisterHtmlLabel: string;
    smtpLoginAnomalySubjectLabel: string;
    smtpLoginAnomalyHtmlLabel: string;
    smtpAutoLocalePlaceholder: string;
    smtpPreviewLocaleLabel: string;
    smtpInviteSubjectLabel: string;
    smtpInviteHtmlLabel: string;
    smtpResetSubjectLabel: string;
    smtpResetHtmlLabel: string;
    smtpTakedownSubjectLabel: string;
    smtpTakedownHtmlLabel: string;
    smtpTemplatePreviewTab: string;
    smtpTemplateSourceTab: string;
    smtpPreviewSubjectPrefix: string;
    smtpViewportDesktop: string;
    smtpViewportMobile: string;
    smtpPreviewLoading: string;
    smtpResetDefaultBtn: string;
    smtpVarsHint: string;
    copyCallbackBtn: string;
    copiedMsg: string;
    logoUploadedMsg: string;
    oauthSecretSavedMsg: string;
    oauthSecretClearedMsg: string;
  };
  studio: {
    autoReadMinutesBadge: (mins: number) => string;
    autoVersionBadge: (ver: number) => string;
    collabSectionTitle: string;
    authorsLabel: string;
    ownerBadge: string;
    coAuthorBadge: string;
    removeCollaboratorBtn: string;
    collaboratorRemovedMsg: string;
    inviteEmailPlaceholder: string;
    inviteBtn: string;
    invitingBtn: string;
    inviteCreatedEmailSentMsg: string;
    inviteCreatedLinkOnlyMsg: string;
    copyInviteLinkBtn: string;
    pendingInvitesLabel: string;
    revokeInviteBtn: string;
    inviteRevokedMsg: string;
    takedownBannerTitle: string;
    takedownBannerMeta: (by: string, reason: string) => string;
    takedownBtn: string;
    restoreBtn: string;
    takedownDialogTitle: (title: string) => string;
    takedownReasonLabel: string;
    takedownReasonPlaceholder: string;
    takedownConfirmBtn: string;
    takedownSuccessMsg: (emailsSent: number) => string;
    restoredSuccessMsg: string;
    takenDownBadge: string;
    deleteTrackBtn: string;
    deleteChapterBtn: string;
    deleteTrackDialogTitle: (slug: string) => string;
    deleteTrackDialogDesc: string;
    deleteChapterDialogTitle: (slug: string) => string;
    deleteChapterDialogDesc: string;
    trackDeletedMsg: string;
    chapterDeletedMsg: string;
    imageUploadedMsg: string;
    editorVisualMode: string;
    editorSourceMode: string;
    editorPreviewToggle: string;
    editorInspectorToggle: string;
    editorInspectorTitle: string;
    editorCloseInspectorAria: string;
    editorToolbarAria: string;
    editorStatusSection: string;
    editorMetaSection: string;
    editorStatusPublished: string;
    editorStatusDraft: string;
    editorCanvasTitlePlaceholder: string;
  };
  users: {
    createUserBtn: string;
    createUserTitle: string;
    usernameLabel: string;
    displayNameLabel: string;
    emailLabel: string;
    roleLabel: string;
    passwordLabel: string;
    createSubmitBtn: string;
    userCreatedMsg: string;
    colStatus: string;
    colActions: string;
    statusActive: string;
    statusBanned: string;
    banBtn: string;
    unbanBtn: string;
    banDialogTitle: (name: string) => string;
    banReasonLabel: string;
    banReasonPlaceholder: string;
    banConfirmBtn: string;
    userBannedMsg: string;
    userUnbannedMsg: string;
    resetPwBtn: string;
    resetPwDialogTitle: (name: string) => string;
    resetPwInputLabel: string;
    resetPwConfirmBtn: string;
    userPwResetMsg: string;
    deleteUserBtn: string;
    deleteUserDialogTitle: (name: string) => string;
    deleteUserDialogDesc: string;
    userDeletedMsg: string;
  };
  reader: {
    authorsPrefix: string;
    coAuthorsMore: (count: number) => string;
  };
}

export const RC3_COPY: Record<LocaleCode, Rc3Messages> = {
  'zh-CN': {
    auth: {
      accountRoleLabel: '账号身份',
      roleReader: '读者',
      roleAuthor: '创作者',
      roleReaderHint: '阅读教程、记录批注与进度',
      roleAuthorHint: '可进入创作后台撰写与发布文章',
      forgotPasswordLink: '忘记密码？',
      forgotPasswordTitle: '找回密码',
      forgotPasswordDesc: '输入你的注册邮箱，若该账号存在我们将发送 6 位重置验证码与快捷重置链接。',
      sendResetBtn: '发送重置验证码',
      sendingResetBtn: '发送中…',
      resetEmailSentMsg: '如果该邮箱已注册，重置验证码已发送，请查收收件箱',
      backToSignIn: '返回登录',
      resetPasswordTitle: '设置新密码',
      newPasswordLabel: '新密码（至少 8 位）',
      confirmPasswordLabel: '确认新密码',
      passwordMismatchMsg: '两次输入的密码不一致',
      resetSubmitBtn: '确认重置并登录',
      resetSuccessMsg: '密码已重置并自动登录',
      onboardingTitle: (provider) => `完成 ${provider} 账号接入`,
      onboardingRegisterTab: '创建新账号',
      onboardingBindTab: '绑定已有账号',
      onboardingBindDesc: '使用现有本站账号密码验证后，即可直接关联此第三方身份。',
      onboardingBindBtn: '验证并绑定账号',
      onboardingCreateBtn: '完成注册并登录',
      onboardingAvatarLabel: '选择头像来源',
      oauthBoundSuccessMsg: '第三方账号绑定成功',
      signedInWelcomeMsg: (name) => `欢迎回来，${name}`,
      registeredWelcomeMsg: (name) => `账号创建成功，欢迎 ${name}`,
      signedOutMsg: '已安全退出登录',
      collabAcceptedMsg: '已接受协作邀请，正在进入文章编辑页',
      collabLoginRequiredMsg: '请先登录或注册账号，以接受文章协作邀请',
      verificationCodeLabel: '邮箱验证码',
      verificationCodePlaceholder: '输入 6 位数字验证码',
      sendCodeBtn: '发送验证码',
      sendingCodeBtn: '发送中…',
      resendCodeCountdown: (seconds) => `${seconds}s 后重发`,
      codeSentToast: (email) => `验证码已发送至 ${email}，10 分钟内有效`,
      backToHome: '返回首页',
      authStepAccount: '填写资料',
      authStepEmail: '输入邮箱',
      authStepVerifyOtp: '邮箱 OTP 验证',
      authStepNewPassword: '设置新密码',
      continueToOtpBtn: '发送验证码并继续',
      verifyOtpContinueBtn: '验证验证码并继续',
      editDetailsBackBtn: '返回修改资料',
      changeEmailBtn: '更换邮箱',
      resendOtpBtn: '重新发送验证码',
      otpInputAria: '6 位一次性数字验证码',
      otpSentSubtitle: (target) => `已向 ${target} 发送 6 位一次性验证码，请在下方依次输入：`,
      resetStep2Desc: (target) =>
        target
          ? `已向 ${target} 发送 6 位重置验证码，验证通过后方可设置新密码：`
          : '请输入注册邮箱及邮件中收到的 6 位验证码，验证通过后方可设置新密码：',
      resetStep3VerifiedBadge: '邮箱验证已通过，请设置并确认你的新密码',
      verifyAndSignInBtn: '验证并登录',
      verifyAndRegisterBtn: '验证并完成注册',
      anomalyTitle: '异常地点或新设备登录验证',
      anomalyDescNewIp: '检测到来自非常用 IP 地点的登录尝试，需通过邮箱一次性验证码确认本人操作。',
      anomalyDescNewDevice: '检测到来自未识别新设备或浏览器的登录尝试，需通过邮箱一次性验证码确认。',
      anomalyDescBoth: '检测到来自陌生 IP 与新设备的异常登录活动，需通过邮箱一次性验证码确认本人操作。',
      anomalyIpLabel: '检测 IP',
      anomalyDeviceLabel: '登录设备',
      resetOtpHint: '完成邮箱 6 位 OTP 验证后，即可进入下一步设置新密码。',
      haveResetCodeBtn: '已有验证码？直接填写',
      loginSubtitle: '使用本站账号登录，继续你的阅读批注与创作工作台。',
      registerSubtitle: '创建账号并通过邮箱 6 位 OTP 验证，开启学习记录与协作创作。',
      noAccountPrompt: '还没有账号？',
      goToRegisterLink: '创建新账号 →',
      hasAccountPrompt: '已有账号？',
      goToLoginLink: '立即登录',
      passwordToggleWarning: '注意：切换后将在屏幕上明文显示密码。',
      passwordRuleHint: '至少 8 位字符，支持粘贴密码管理器生成的强密码。',
      usernameRuleHint: '3–32 位字母、数字、下划线或连字符。',
      usernameChecking: '正在检查用户名可用性…',
      usernameAvailable: '用户名可用',
      usernameTaken: '该用户名已被占用，请更换',
      usernameInvalidFormat: '仅支持 3–32 位字母、数字、下划线或连字符',
      pwStrengthLabel: '密码强度',
      pwStrengthIdle: '未输入',
      pwStrengthWeak: '弱',
      pwStrengthFair: '一般',
      pwStrengthGood: '较强',
      pwStrengthStrong: '强',
      pwStrengthAdvisory: '强度仅供参考，不限制保存 · 建议组合大小写、数字与符号',
      securityFooterNote: '',
      stepProgressAria: '认证流程进度',
      errorPrefixLabel: '错误',
      errIdentifierRequired: '请输入用户名或注册邮箱。',
      errUsernameInvalid: '请输入至少 3 位字符的用户名。',
      errEmailInvalid: '请输入有效的邮箱地址（例如 you@example.com）。',
      errPasswordLength: '密码长度至少需要 8 位字符。',
      errOtpLength: '请输入邮件收到的完整 6 位数字验证码。',
    },
    profile: {
      menuItem: '个人资料与安全',
      title: '个人资料与账号安全',
      tabProfile: '资料与头像',
      tabSecurity: '安全与绑定',
      tabSessions: '设备与会话',
      sessionsTitle: '已登录设备与活跃会话',
      sessionsDesc: '记录每次登录的 IP 地址与设备信息。发现异常活动时可随时下线对应设备，新 IP 或新设备登录将触发邮箱 OTP 验证。',
      sessionsEmpty: '暂无其他活跃会话记录',
      sessionCurrentBadge: '当前设备',
      sessionIpLabel: 'IP',
      sessionLastSeenLabel: '最近活跃',
      sessionCreatedLabel: '首次登录',
      sessionRevokeBtn: '下线',
      sessionRevokeOthersBtn: '下线其他全部设备',
      sessionRevokedMsg: '已强制下线该设备会话',
      sessionOthersRevokedMsg: (count) =>
        count > 0 ? `已下线其他 ${count} 台设备的活跃会话` : '当前没有其他在线设备',
      displayNameLabel: '显示昵称',
      bioLabel: '个人简介',
      bioPlaceholder: '写一句简短的自我介绍…',
      avatarSourceLabel: '头像来源',
      avatarDefault: '默认菱形徽标',
      avatarGravatar: 'Gravatar 头像',
      avatarOAuth: '第三方头像',
      avatarUpload: '自定义上传',
      uploadAvatarBtn: '上传新头像',
      uploadingAvatarBtn: '上传中…',
      saveProfileBtn: '保存资料',
      savingProfileBtn: '保存中…',
      profileSavedMsg: '个人资料已更新',
      oauthLinkTitle: '第三方登录绑定',
      oauthLinkedBadge: (provider) => `已绑定 ${provider}`,
      oauthNotLinkedText: '尚未绑定第三方 OAuth 账号',
      oauthBindBtn: (provider) => `前往绑定 ${provider}`,
      changePasswordTitle: '修改登录密码',
      currentPasswordLabel: '当前密码（若未设置可留空）',
      newPasswordLabel: '新密码（至少 8 位）',
      confirmPasswordLabel: '确认新密码',
      changePasswordBtn: '更新密码',
      changingPasswordBtn: '更新中…',
      passwordChangedMsg: '登录密码已更新',
    },
    settings: {
      allowAuthorRegistrationLabel: '允许新用户注册时直接选择创作者身份',
      gravatarBaseUrlLabel: 'Gravatar 镜像 / 代理地址',
      gravatarBaseUrlPlaceholder: 'https://www.gravatar.com/avatar',
      smtpGroup: 'SMTP 邮件与通知模板',
      smtpEnabledLabel: '启用 SMTP 邮件发送（注册验证码、协作邀请、密码重置与下架通知）',
      smtpHostLabel: 'SMTP 服务器主机',
      smtpPortLabel: '端口',
      smtpEncryptionLabel: '加密方式',
      smtpEncTls: '隐式 TLS (465)',
      smtpEncStarttls: 'STARTTLS (587)',
      smtpEncNone: '无加密 (25)',
      smtpUsernameLabel: 'SMTP 用户名',
      smtpPasswordLabel: 'SMTP 密码 / 授权码',
      smtpPasswordSavedBadge: '已保存密码',
      smtpClearPasswordBtn: '清除密码',
      smtpFromNameLabel: '发件人名称',
      smtpFromEmailLabel: '发件人邮箱',
      smtpEmailFooterLabel: '自定义邮件页脚（可选，支持 {{site_name}}）',
      smtpEmailFooterPlaceholder: '留空则使用默认多语言手账页脚，例如：© 2026 {{site_name}} · 联系支持 support@example.com',
      smtpSaveBtn: '保存 SMTP 设置',
      smtpSavingBtn: '保存中…',
      smtpSavedMsg: 'SMTP 设置已保存',
      smtpTestEmailLabel: '测试收件邮箱',
      smtpTestBtn: '发送测试邮件',
      smtpTestingBtn: '发送中…',
      smtpTestSentMsg: '测试邮件已发送，请检查收件箱',
      smtpTemplatesToggle: '邮件通知模板与多语言实图预览（注册 / 异常登录 / 重置 / 邀请 / 下架）',
      smtpRegisterCodeTab: '注册验证码',
      smtpLoginAnomalyTab: '异常登录 OTP',
      smtpInviteTab: '协作邀请',
      smtpResetTab: '密码重置',
      smtpTakedownTab: '下架通知',
      smtpRegisterSubjectLabel: '注册验证码邮件标题',
      smtpRegisterHtmlLabel: '注册验证码 HTML 源码',
      smtpLoginAnomalySubjectLabel: '异常登录安全验证标题',
      smtpLoginAnomalyHtmlLabel: '异常登录安全验证 HTML 源码',
      smtpAutoLocalePlaceholder: '留空则自动使用内置多语言模板（跟随用户站点语言与站点 LOGO）',
      smtpPreviewLocaleLabel: '预览语言',
      smtpInviteSubjectLabel: '协作邀请标题',
      smtpInviteHtmlLabel: '协作邀请 HTML 源码',
      smtpResetSubjectLabel: '密码重置标题',
      smtpResetHtmlLabel: '密码重置 HTML 源码',
      smtpTakedownSubjectLabel: '文章下架通知标题',
      smtpTakedownHtmlLabel: '文章下架通知 HTML 源码',
      smtpTemplatePreviewTab: '实时效果预览',
      smtpTemplateSourceTab: 'HTML 源码',
      smtpPreviewSubjectPrefix: '主题：',
      smtpViewportDesktop: '桌面 560px',
      smtpViewportMobile: '手机 375px',
      smtpPreviewLoading: '正在渲染邮件预览…',
      smtpResetDefaultBtn: '恢复默认模板',
      smtpVarsHint: '支持占位符：{{site_name}}、{{logo_html}}、{{email}}、{{code}}、{{ip_address}}、{{device_label}}、{{anomaly_summary}}、{{occurred_at}}、{{inviter_name}}、{{recipient_name}}、{{article_title}}、{{reason}}、{{expires_minutes}}、{{action_url}}',
      copyCallbackBtn: '复制回调地址',
      copiedMsg: '已复制到剪贴板',
      logoUploadedMsg: '站点 LOGO 已上传，记得保存设置',
      oauthSecretSavedMsg: 'OAuth Client Secret 已更新',
      oauthSecretClearedMsg: 'OAuth Client Secret 已清除',
    },
    studio: {
      autoReadMinutesBadge: (mins) => `预计 ${mins} 分钟`,
      autoVersionBadge: (ver) => `自动版本 v${ver}`,
      collabSectionTitle: '共创作者与协作邀请',
      authorsLabel: '文章作者',
      ownerBadge: '主作者',
      coAuthorBadge: '协作者',
      removeCollaboratorBtn: '移除',
      collaboratorRemovedMsg: '已移除协作者',
      inviteEmailPlaceholder: '输入协作者邮箱地址…',
      inviteBtn: '发送邀请',
      invitingBtn: '邀请中…',
      inviteCreatedEmailSentMsg: '协作邀请邮件已发送，也可直接复制邀请链接',
      inviteCreatedLinkOnlyMsg: '已生成协作邀请链接（未启用 SMTP 邮件，请复制链接发送给协作者）',
      copyInviteLinkBtn: '复制邀请链接',
      pendingInvitesLabel: '待接受邀请',
      revokeInviteBtn: '撤销',
      inviteRevokedMsg: '邀请已撤销',
      takedownBannerTitle: '此文章已被管理员下架',
      takedownBannerMeta: (by, reason) => `处理人：${by || '管理员'} · 原因：${reason}`,
      takedownBtn: '下架文章',
      restoreBtn: '恢复上架',
      takedownDialogTitle: (title) => `下架文章「${title}」`,
      takedownReasonLabel: '下架原因（将展示给作者并发送通知邮件）',
      takedownReasonPlaceholder: '请说明违规或需要整改的具体原因…',
      takedownConfirmBtn: '确认下架',
      takedownSuccessMsg: (emailsSent) =>
        emailsSent > 0 ? `文章已下架，并已发送 ${emailsSent} 封邮件通知作者` : '文章已下架',
      restoredSuccessMsg: '文章已恢复上架',
      takenDownBadge: '已下架',
      deleteTrackBtn: '删除专题',
      deleteChapterBtn: '删除章节',
      deleteTrackDialogTitle: (slug) => `删除专题「${slug}」？`,
      deleteTrackDialogDesc: '此操作会永久移除该专题及其下全部章节与文章文件，无法撤销。',
      deleteChapterDialogTitle: (slug) => `删除章节「${slug}」？`,
      deleteChapterDialogDesc: '此操作会永久移除该章节及其下全部文章文件，无法撤销。',
      trackDeletedMsg: '专题已删除',
      chapterDeletedMsg: '章节已删除',
      imageUploadedMsg: '图片已上传并插入',
      editorVisualMode: '可视化视图',
      editorSourceMode: '源代码',
      editorPreviewToggle: '实时预览',
      editorInspectorToggle: '文章信息',
      editorInspectorTitle: '文章信息栏',
      editorCloseInspectorAria: '收起文章信息栏',
      editorToolbarAria: '编辑工具栏',
      editorStatusSection: '发布与状态',
      editorMetaSection: '元数据与分类',
      editorStatusPublished: '已发布',
      editorStatusDraft: '草稿',
      editorCanvasTitlePlaceholder: '在此输入文章标题…',
    },
    users: {
      createUserBtn: '+ 新增用户',
      createUserTitle: '创建新用户账号',
      usernameLabel: '用户名',
      displayNameLabel: '显示昵称',
      emailLabel: '邮箱',
      roleLabel: '角色',
      passwordLabel: '初始密码（至少 8 位）',
      createSubmitBtn: '创建用户',
      userCreatedMsg: '用户已创建',
      colStatus: '状态',
      colActions: '操作',
      statusActive: '正常',
      statusBanned: '已封禁',
      banBtn: '封禁',
      unbanBtn: '解封',
      banDialogTitle: (name) => `封禁用户「${name}」`,
      banReasonLabel: '封禁原因（可选）',
      banReasonPlaceholder: '例如：发布违规内容…',
      banConfirmBtn: '确认封禁',
      userBannedMsg: '用户已被封禁并注销会话',
      userUnbannedMsg: '用户已解封',
      resetPwBtn: '重置密码',
      resetPwDialogTitle: (name) => `重置「${name}」的密码`,
      resetPwInputLabel: '新密码（至少 8 位）',
      resetPwConfirmBtn: '确认重置',
      userPwResetMsg: '用户密码已重置',
      deleteUserBtn: '删除',
      deleteUserDialogTitle: (name) => `永久删除用户「${name}」？`,
      deleteUserDialogDesc: '将移除该用户账号与会话记录，此操作不可恢复。',
      userDeletedMsg: '用户已删除',
    },
    reader: {
      authorsPrefix: '作者',
      coAuthorsMore: (count) => `等 ${count} 位作者`,
    },
  },
  en: {
    auth: {
      accountRoleLabel: 'Account Role',
      roleReader: 'Reader',
      roleAuthor: 'Author',
      roleReaderHint: 'Read notebooks, save notes & task progress',
      roleAuthorHint: 'Access Studio to write & publish articles',
      forgotPasswordLink: 'Forgot password?',
      forgotPasswordTitle: 'Reset Password',
      forgotPasswordDesc: 'Enter your registered email. If an account matches, we will send a 6-digit verification code and reset link.',
      sendResetBtn: 'Send Reset Code',
      sendingResetBtn: 'Sending…',
      resetEmailSentMsg: 'If this email is registered, a reset verification code has been sent.',
      backToSignIn: 'Back to Sign In',
      resetPasswordTitle: 'Choose New Password',
      newPasswordLabel: 'New password (min 8 characters)',
      confirmPasswordLabel: 'Confirm new password',
      passwordMismatchMsg: 'Passwords do not match.',
      resetSubmitBtn: 'Reset Password & Sign In',
      resetSuccessMsg: 'Password updated and signed in.',
      onboardingTitle: (provider) => `Finish ${provider} Sign-In`,
      onboardingRegisterTab: 'Create Account',
      onboardingBindTab: 'Link Existing Account',
      onboardingBindDesc: 'Sign in with your existing local credentials to link this OAuth identity.',
      onboardingBindBtn: 'Verify & Link Account',
      onboardingCreateBtn: 'Create Account & Sign In',
      onboardingAvatarLabel: 'Avatar Source',
      oauthBoundSuccessMsg: 'OAuth identity linked to your account.',
      signedInWelcomeMsg: (name) => `Welcome back, ${name}`,
      registeredWelcomeMsg: (name) => `Account created. Welcome, ${name}!`,
      signedOutMsg: 'Signed out successfully.',
      collabAcceptedMsg: 'Collaboration invite accepted. Opening editor…',
      collabLoginRequiredMsg: 'Sign in or create an account to accept this collaboration invite.',
      verificationCodeLabel: 'Email Verification Code',
      verificationCodePlaceholder: '6-digit code',
      sendCodeBtn: 'Send Code',
      sendingCodeBtn: 'Sending…',
      resendCodeCountdown: (seconds) => `Resend (${seconds}s)`,
      codeSentToast: (email) => `Verification code sent to ${email} (valid for 10 min).`,
      backToHome: 'Back to Home',
      authStepAccount: 'Account Info',
      authStepEmail: 'Email',
      authStepVerifyOtp: 'Email OTP',
      authStepNewPassword: 'New Password',
      continueToOtpBtn: 'Send Code & Continue',
      verifyOtpContinueBtn: 'Verify Code & Continue',
      editDetailsBackBtn: 'Edit Details',
      changeEmailBtn: 'Change email',
      resendOtpBtn: 'Resend code',
      otpInputAria: '6-digit one-time verification code',
      otpSentSubtitle: (target) => `Enter the 6-digit one-time code sent to ${target}:`,
      resetStep2Desc: (target) =>
        target
          ? `Enter the 6-digit reset code sent to ${target} to continue:`
          : 'Enter your registered email and the 6-digit reset code from your email to continue:',
      resetStep3VerifiedBadge: 'Email OTP verified — set and confirm your new password',
      verifyAndSignInBtn: 'Verify & Sign In',
      verifyAndRegisterBtn: 'Verify & Create Account',
      anomalyTitle: 'Unusual Location or New Device Sign-In',
      anomalyDescNewIp: 'We detected a sign-in from an unrecognized IP address. Enter the email verification code to confirm it is you.',
      anomalyDescNewDevice: 'We detected a sign-in from a new device or browser. Enter the email verification code to confirm it is you.',
      anomalyDescBoth: 'We detected unusual activity from both a new IP address and a new device. Enter the email verification code to confirm it is you.',
      anomalyIpLabel: 'Detected IP',
      anomalyDeviceLabel: 'Device',
      resetOtpHint: 'Verify the 6-digit code sent to your email before choosing a new password.',
      haveResetCodeBtn: 'Already have a code? Enter it now',
      loginSubtitle: 'Sign in to sync reading notes, task progress, and your Studio workspace.',
      registerSubtitle: 'Create an account with 6-digit email OTP verification.',
      noAccountPrompt: 'New here?',
      goToRegisterLink: 'Create an account →',
      hasAccountPrompt: 'Already have an account?',
      goToLoginLink: 'Sign in',
      passwordToggleWarning: 'Warning: this will display your password on the screen.',
      passwordRuleHint: 'At least 8 characters. Password managers and pasting are supported.',
      usernameRuleHint: '3–32 characters (letters, numbers, underscores, or hyphens).',
      usernameChecking: 'Checking username availability…',
      usernameAvailable: 'Username is available',
      usernameTaken: 'This username is already taken',
      usernameInvalidFormat: 'Use 3–32 letters, numbers, underscores, or hyphens',
      pwStrengthLabel: 'Password strength',
      pwStrengthIdle: 'Not entered',
      pwStrengthWeak: 'Weak',
      pwStrengthFair: 'Fair',
      pwStrengthGood: 'Good',
      pwStrengthStrong: 'Strong',
      pwStrengthAdvisory: 'Advisory only — mixing cases, numbers & symbols improves security',
      securityFooterNote: '',
      stepProgressAria: 'Authentication progress',
      errorPrefixLabel: 'Error',
      errIdentifierRequired: 'Enter your username or email address.',
      errUsernameInvalid: 'Enter a username with at least 3 characters.',
      errEmailInvalid: 'Enter an email address in the format you@example.com.',
      errPasswordLength: 'Password must be at least 8 characters.',
      errOtpLength: 'Enter all 6 digits from your verification email.',
    },
    profile: {
      menuItem: 'Profile & Security',
      title: 'Profile & Account Security',
      tabProfile: 'Profile & Avatar',
      tabSecurity: 'Security & Links',
      tabSessions: 'Devices & Sessions',
      sessionsTitle: 'Active Devices & Sessions',
      sessionsDesc: 'Each sign-in records its IP address and device details. Revoke unfamiliar devices anytime; signing in from a new IP or device triggers an email OTP check.',
      sessionsEmpty: 'No other active sessions found.',
      sessionCurrentBadge: 'Current device',
      sessionIpLabel: 'IP',
      sessionLastSeenLabel: 'Last active',
      sessionCreatedLabel: 'Signed in',
      sessionRevokeBtn: 'Sign out',
      sessionRevokeOthersBtn: 'Sign out all other devices',
      sessionRevokedMsg: 'Session signed out.',
      sessionOthersRevokedMsg: (count) =>
        count > 0 ? `Signed out ${count} other active session(s).` : 'No other active devices to sign out.',
      displayNameLabel: 'Display Name',
      bioLabel: 'Bio',
      bioPlaceholder: 'A short line about yourself…',
      avatarSourceLabel: 'Avatar Source',
      avatarDefault: 'Default Monogram',
      avatarGravatar: 'Gravatar',
      avatarOAuth: 'OAuth Avatar',
      avatarUpload: 'Uploaded Image',
      uploadAvatarBtn: 'Upload Avatar',
      uploadingAvatarBtn: 'Uploading…',
      saveProfileBtn: 'Save Profile',
      savingProfileBtn: 'Saving…',
      profileSavedMsg: 'Profile updated.',
      oauthLinkTitle: 'Linked OAuth Identity',
      oauthLinkedBadge: (provider) => `Linked: ${provider}`,
      oauthNotLinkedText: 'No OAuth account linked yet.',
      oauthBindBtn: (provider) => `Link ${provider}`,
      changePasswordTitle: 'Change Password',
      currentPasswordLabel: 'Current password (leave blank if unset)',
      newPasswordLabel: 'New password (min 8 characters)',
      confirmPasswordLabel: 'Confirm new password',
      changePasswordBtn: 'Update Password',
      changingPasswordBtn: 'Updating…',
      passwordChangedMsg: 'Password updated successfully.',
    },
    settings: {
      allowAuthorRegistrationLabel: 'Allow new users to register directly as Authors',
      gravatarBaseUrlLabel: 'Gravatar Mirror / Base URL',
      gravatarBaseUrlPlaceholder: 'https://www.gravatar.com/avatar',
      smtpGroup: 'SMTP Mail & Notification Templates',
      smtpEnabledLabel: 'Enable SMTP email delivery (verification codes, invites, resets & takedowns)',
      smtpHostLabel: 'SMTP Host',
      smtpPortLabel: 'Port',
      smtpEncryptionLabel: 'Encryption',
      smtpEncTls: 'Implicit TLS (465)',
      smtpEncStarttls: 'STARTTLS (587)',
      smtpEncNone: 'Plain (25)',
      smtpUsernameLabel: 'SMTP Username',
      smtpPasswordLabel: 'SMTP Password',
      smtpPasswordSavedBadge: 'Password saved',
      smtpClearPasswordBtn: 'Clear password',
      smtpFromNameLabel: 'Sender Name',
      smtpFromEmailLabel: 'Sender Email',
      smtpEmailFooterLabel: 'Custom Email Footer (optional, supports {{site_name}})',
      smtpEmailFooterPlaceholder: 'Leave blank for localized default footer, e.g. © 2026 {{site_name}} · support@example.com',
      smtpSaveBtn: 'Save SMTP Settings',
      smtpSavingBtn: 'Saving…',
      smtpSavedMsg: 'SMTP settings saved.',
      smtpTestEmailLabel: 'Test Recipient Email',
      smtpTestBtn: 'Send Test Email',
      smtpTestingBtn: 'Sending…',
      smtpTestSentMsg: 'Test email sent. Check your inbox.',
      smtpTemplatesToggle: 'Email Templates & Multi-Locale Live Preview (Verification / Anomaly OTP / Reset / Invite / Takedown)',
      smtpRegisterCodeTab: 'Verification Code',
      smtpLoginAnomalyTab: 'Anomaly Login OTP',
      smtpInviteTab: 'Co-Author Invite',
      smtpResetTab: 'Password Reset',
      smtpTakedownTab: 'Takedown Notice',
      smtpRegisterSubjectLabel: 'Verification Code Subject',
      smtpRegisterHtmlLabel: 'Verification Code HTML Source',
      smtpLoginAnomalySubjectLabel: 'Anomaly Login OTP Subject',
      smtpLoginAnomalyHtmlLabel: 'Anomaly Login OTP HTML Source',
      smtpAutoLocalePlaceholder: 'Leave blank to use built-in localized templates matching user language & site logo',
      smtpPreviewLocaleLabel: 'Preview Locale',
      smtpInviteSubjectLabel: 'Invite Subject',
      smtpInviteHtmlLabel: 'Invite HTML Source',
      smtpResetSubjectLabel: 'Password Reset Subject',
      smtpResetHtmlLabel: 'Password Reset HTML Source',
      smtpTakedownSubjectLabel: 'Takedown Subject',
      smtpTakedownHtmlLabel: 'Takedown HTML Source',
      smtpTemplatePreviewTab: 'Live Preview',
      smtpTemplateSourceTab: 'HTML Source',
      smtpPreviewSubjectPrefix: 'Subject: ',
      smtpViewportDesktop: 'Desktop 560px',
      smtpViewportMobile: 'Mobile 375px',
      smtpPreviewLoading: 'Rendering email preview…',
      smtpResetDefaultBtn: 'Reset to Default',
      smtpVarsHint: 'Variables: {{site_name}}, {{logo_html}}, {{email}}, {{code}}, {{ip_address}}, {{device_label}}, {{anomaly_summary}}, {{occurred_at}}, {{inviter_name}}, {{recipient_name}}, {{article_title}}, {{reason}}, {{expires_minutes}}, {{action_url}}',
      copyCallbackBtn: 'Copy Callback URL',
      copiedMsg: 'Copied to clipboard.',
      logoUploadedMsg: 'Site logo uploaded. Save settings to apply.',
      oauthSecretSavedMsg: 'OAuth client secret saved.',
      oauthSecretClearedMsg: 'OAuth client secret cleared.',
    },
    studio: {
      autoReadMinutesBadge: (mins) => `~${mins} min read`,
      autoVersionBadge: (ver) => `Auto v${ver}`,
      collabSectionTitle: 'Co-Authors & Invites',
      authorsLabel: 'Authors',
      ownerBadge: 'Owner',
      coAuthorBadge: 'Co-author',
      removeCollaboratorBtn: 'Remove',
      collaboratorRemovedMsg: 'Collaborator removed.',
      inviteEmailPlaceholder: 'Collaborator email address…',
      inviteBtn: 'Send Invite',
      invitingBtn: 'Inviting…',
      inviteCreatedEmailSentMsg: 'Invite email sent. You can also copy the link below.',
      inviteCreatedLinkOnlyMsg: 'Invite link generated (SMTP disabled — share the link directly).',
      copyInviteLinkBtn: 'Copy Invite Link',
      pendingInvitesLabel: 'Pending Invites',
      revokeInviteBtn: 'Revoke',
      inviteRevokedMsg: 'Invitation revoked.',
      takedownBannerTitle: 'This article has been taken down by an administrator',
      takedownBannerMeta: (by, reason) => `By: ${by || 'Admin'} · Reason: ${reason}`,
      takedownBtn: 'Take Down',
      restoreBtn: 'Restore',
      takedownDialogTitle: (title) => `Take down "${title}"`,
      takedownReasonLabel: 'Reason (shown to authors and emailed if SMTP is enabled)',
      takedownReasonPlaceholder: 'Explain why this article was taken down…',
      takedownConfirmBtn: 'Confirm Takedown',
      takedownSuccessMsg: (emailsSent) =>
        emailsSent > 0
          ? `Article taken down (${emailsSent} notification email(s) sent).`
          : 'Article taken down.',
      restoredSuccessMsg: 'Article restored.',
      takenDownBadge: 'Taken Down',
      deleteTrackBtn: 'Delete Track',
      deleteChapterBtn: 'Delete Chapter',
      deleteTrackDialogTitle: (slug) => `Delete track "${slug}"?`,
      deleteTrackDialogDesc: 'This permanently deletes the track, all chapters, and all article files inside it.',
      deleteChapterDialogTitle: (slug) => `Delete chapter "${slug}"?`,
      deleteChapterDialogDesc: 'This permanently deletes the chapter and all article files inside it.',
      trackDeletedMsg: 'Track deleted.',
      chapterDeletedMsg: 'Chapter deleted.',
      imageUploadedMsg: 'Image uploaded and inserted.',
      editorVisualMode: 'Visual',
      editorSourceMode: 'Source',
      editorPreviewToggle: 'Preview',
      editorInspectorToggle: 'Info',
      editorInspectorTitle: 'Article Inspector',
      editorCloseInspectorAria: 'Close article inspector',
      editorToolbarAria: 'Editor toolbar',
      editorStatusSection: 'Status & Revision',
      editorMetaSection: 'Metadata',
      editorStatusPublished: 'Published',
      editorStatusDraft: 'Draft',
      editorCanvasTitlePlaceholder: 'Write article title…',
    },
    users: {
      createUserBtn: '+ Add User',
      createUserTitle: 'Create User Account',
      usernameLabel: 'Username',
      displayNameLabel: 'Display Name',
      emailLabel: 'Email',
      roleLabel: 'Role',
      passwordLabel: 'Initial Password (min 8 chars)',
      createSubmitBtn: 'Create User',
      userCreatedMsg: 'User created.',
      colStatus: 'Status',
      colActions: 'Actions',
      statusActive: 'Active',
      statusBanned: 'Suspended',
      banBtn: 'Suspend',
      unbanBtn: 'Unsuspend',
      banDialogTitle: (name) => `Suspend "${name}"`,
      banReasonLabel: 'Reason (optional)',
      banReasonPlaceholder: 'Optional reason shown on sign-in…',
      banConfirmBtn: 'Confirm Suspension',
      userBannedMsg: 'User suspended and sessions revoked.',
      userUnbannedMsg: 'User unsuspended.',
      resetPwBtn: 'Reset PW',
      resetPwDialogTitle: (name) => `Reset password for "${name}"`,
      resetPwInputLabel: 'New Password (min 8 chars)',
      resetPwConfirmBtn: 'Reset Password',
      userPwResetMsg: 'User password reset.',
      deleteUserBtn: 'Delete',
      deleteUserDialogTitle: (name) => `Permanently delete "${name}"?`,
      deleteUserDialogDesc: 'This removes the user account and active sessions permanently.',
      userDeletedMsg: 'User deleted.',
    },
    reader: {
      authorsPrefix: 'By',
      coAuthorsMore: (count) => `${count} authors`,
    },
  },
  'zh-TW': {
    auth: {
      accountRoleLabel: '帳號身分',
      roleReader: '讀者',
      roleAuthor: '創作者',
      roleReaderHint: '閱讀筆記、記錄批註與學習進度',
      roleAuthorHint: '可進入創作後台撰寫與發佈文章',
      forgotPasswordLink: '忘記密碼？',
      forgotPasswordTitle: '重設密碼',
      forgotPasswordDesc: '輸入您的註冊信箱，若帳號存在我們將寄送 6 位重設驗證碼與快捷重設連結。',
      sendResetBtn: '寄送重設驗證碼',
      sendingResetBtn: '寄送中…',
      resetEmailSentMsg: '若該信箱已註冊，重設驗證碼已寄出，請查看收件匣',
      backToSignIn: '返回登入',
      resetPasswordTitle: '設定新密碼',
      newPasswordLabel: '新密碼（至少 8 個字元）',
      confirmPasswordLabel: '確認新密碼',
      passwordMismatchMsg: '兩次輸入的密碼不一致',
      resetSubmitBtn: '確認重設並登入',
      resetSuccessMsg: '密碼已重設並自動登入',
      onboardingTitle: (provider) => `完成 ${provider} 帳號綁定`,
      onboardingRegisterTab: '建立新帳號',
      onboardingBindTab: '綁定既有帳號',
      onboardingBindDesc: '驗證既有本站帳號密碼後，即可直接關聯此第三方身分。',
      onboardingBindBtn: '驗證並綁定帳號',
      onboardingCreateBtn: '完成註冊並登入',
      onboardingAvatarLabel: '選擇頭像來源',
      oauthBoundSuccessMsg: '第三方帳號綁定成功',
      signedInWelcomeMsg: (name) => `歡迎回來，${name}`,
      registeredWelcomeMsg: (name) => `帳號建立成功，歡迎 ${name}`,
      signedOutMsg: '已安全登出',
      collabAcceptedMsg: '已接受協作邀請，正在進入編輯器',
      collabLoginRequiredMsg: '請先登入或註冊帳號，以接受文章協作邀請',
      verificationCodeLabel: '信箱驗證碼',
      verificationCodePlaceholder: '輸入 6 位數字驗證碼',
      sendCodeBtn: '寄送驗證碼',
      sendingCodeBtn: '寄送中…',
      resendCodeCountdown: (seconds) => `${seconds}s 後重寄`,
      codeSentToast: (email) => `驗證碼已寄送至 ${email}，10 分鐘內有效`,
      backToHome: '返回首頁',
      authStepAccount: '填寫資料',
      authStepEmail: '輸入信箱',
      authStepVerifyOtp: '信箱 OTP 驗證',
      authStepNewPassword: '設定新密碼',
      continueToOtpBtn: '寄送驗證碼並繼續',
      verifyOtpContinueBtn: '驗證驗證碼並繼續',
      editDetailsBackBtn: '返回修改資料',
      changeEmailBtn: '更換信箱',
      resendOtpBtn: '重新寄送驗證碼',
      otpInputAria: '6 位一次性數字驗證碼',
      otpSentSubtitle: (target) => `已寄送 6 位一次性驗證碼至 ${target}，請於下方依序輸入：`,
      resetStep2Desc: (target) =>
        target
          ? `已寄送 6 位重設驗證碼至 ${target}，驗證通過後方可設定新密碼：`
          : '請輸入註冊信箱與信件收到的 6 位驗證碼，驗證通過後方可設定新密碼：',
      resetStep3VerifiedBadge: '信箱驗證已通過，請設定並確認您的新密碼',
      verifyAndSignInBtn: '驗證並登入',
      verifyAndRegisterBtn: '驗證並完成註冊',
      anomalyTitle: '異常地點或新裝置登入驗證',
      anomalyDescNewIp: '偵測到來自非常用 IP 位置的登入嘗試，請透過信箱一次性驗證碼確認本人操作。',
      anomalyDescNewDevice: '偵測到來自未識別新裝置或瀏覽器的登入嘗試，請透過信箱一次性驗證碼確認本人操作。',
      anomalyDescBoth: '偵測到來自陌生 IP 與新裝置的異常登入活動，請透過信箱一次性驗證碼確認本人操作。',
      anomalyIpLabel: '偵測 IP',
      anomalyDeviceLabel: '登入裝置',
      resetOtpHint: '完成信箱 6 位 OTP 驗證後，即可進入下一步設定新密碼。',
      haveResetCodeBtn: '已有驗證碼？直接輸入',
      loginSubtitle: '登入本站帳號，同步閱讀批註、任務進度與創作工作台。',
      registerSubtitle: '建立帳號並完成信箱 6 位 OTP 驗證，開啟筆記與協作創作。',
      noAccountPrompt: '還沒有帳號？',
      goToRegisterLink: '建立新帳號 →',
      hasAccountPrompt: '已經有帳號？',
      goToLoginLink: '立即登入',
      passwordToggleWarning: '注意：切換後將在畫面上明文顯示密碼。',
      passwordRuleHint: '至少 8 個字元，支援貼上密碼管理器產生的強密碼。',
      usernameRuleHint: '3–32 位英數字、底線或連字號。',
      usernameChecking: '正在檢查用戶名可用性…',
      usernameAvailable: '用戶名可用',
      usernameTaken: '此用戶名已被使用，請更換',
      usernameInvalidFormat: '僅支援 3–32 位英數字、底線或連字號',
      pwStrengthLabel: '密碼強度',
      pwStrengthIdle: '未輸入',
      pwStrengthWeak: '弱',
      pwStrengthFair: '一般',
      pwStrengthGood: '較強',
      pwStrengthStrong: '強',
      pwStrengthAdvisory: '強度僅供參考，不限制儲存 · 建議混合大小寫、數字與符號',
      securityFooterNote: '',
      stepProgressAria: '認證流程進度',
      errorPrefixLabel: '錯誤',
      errIdentifierRequired: '請輸入用戶名或註冊信箱。',
      errUsernameInvalid: '請輸入至少 3 個字元的用戶名。',
      errEmailInvalid: '請輸入有效的信箱格式（例如 you@example.com）。',
      errPasswordLength: '密碼長度至少需要 8 個字元。',
      errOtpLength: '請輸入信件收到的完整 6 位數字驗證碼。',
    },
    profile: {
      menuItem: '個人資料與安全',
      title: '個人資料與帳號安全',
      tabProfile: '資料與頭像',
      tabSecurity: '安全與綁定',
      tabSessions: '裝置與工作階段',
      sessionsTitle: '已登入裝置與活躍工作階段',
      sessionsDesc: '記錄每次登入的 IP 位址與裝置資訊。若發現異常活動可隨時強制下線，切換新 IP 或新裝置時將觸發信箱 OTP 驗證。',
      sessionsEmpty: '目前沒有其他活躍工作階段',
      sessionCurrentBadge: '目前裝置',
      sessionIpLabel: 'IP',
      sessionLastSeenLabel: '最近活躍',
      sessionCreatedLabel: '登入時間',
      sessionRevokeBtn: '下線',
      sessionRevokeOthersBtn: '下線其他全部裝置',
      sessionRevokedMsg: '已強制下線該裝置工作階段',
      sessionOthersRevokedMsg: (count) =>
        count > 0 ? `已下線其他 ${count} 台裝置的活躍工作階段` : '目前沒有其他線上裝置',
      displayNameLabel: '顯示名稱',
      bioLabel: '個人簡介',
      bioPlaceholder: '寫一句簡短的自我介紹…',
      avatarSourceLabel: '頭像來源',
      avatarDefault: '預設菱形徽標',
      avatarGravatar: 'Gravatar 頭像',
      avatarOAuth: '第三方頭像',
      avatarUpload: '自訂上傳',
      uploadAvatarBtn: '上傳新頭像',
      uploadingAvatarBtn: '上傳中…',
      saveProfileBtn: '儲存資料',
      savingProfileBtn: '儲存中…',
      profileSavedMsg: '個人資料已更新',
      oauthLinkTitle: '第三方登入綁定',
      oauthLinkedBadge: (provider) => `已綁定 ${provider}`,
      oauthNotLinkedText: '尚未綁定第三方 OAuth 帳號',
      oauthBindBtn: (provider) => `前往綁定 ${provider}`,
      changePasswordTitle: '變更登入密碼',
      currentPasswordLabel: '目前密碼（若尚未設定可留空）',
      newPasswordLabel: '新密碼（至少 8 個字元）',
      confirmPasswordLabel: '確認新密碼',
      changePasswordBtn: '更新密碼',
      changingPasswordBtn: '更新中…',
      passwordChangedMsg: '登入密碼已更新',
    },
    settings: {
      allowAuthorRegistrationLabel: '允許新用戶註冊時直接選擇創作者身分',
      gravatarBaseUrlLabel: 'Gravatar 鏡像 / 代理網址',
      gravatarBaseUrlPlaceholder: 'https://www.gravatar.com/avatar',
      smtpGroup: 'SMTP 郵件與通知範本',
      smtpEnabledLabel: '啟用 SMTP 郵件寄送（註冊驗證碼、協作邀請、密碼重設與下架通知）',
      smtpHostLabel: 'SMTP 伺服器主機',
      smtpPortLabel: '連接埠',
      smtpEncryptionLabel: '加密方式',
      smtpEncTls: '隱式 TLS (465)',
      smtpEncStarttls: 'STARTTLS (587)',
      smtpEncNone: '無加密 (25)',
      smtpUsernameLabel: 'SMTP 用戶名',
      smtpPasswordLabel: 'SMTP 密碼 / 授權碼',
      smtpPasswordSavedBadge: '已儲存密碼',
      smtpClearPasswordBtn: '清除密碼',
      smtpFromNameLabel: '寄件人名稱',
      smtpFromEmailLabel: '寄件人信箱',
      smtpEmailFooterLabel: '自訂郵件頁尾（選填，支援 {{site_name}}）',
      smtpEmailFooterPlaceholder: '留空則使用預設多語言手帳頁尾，例如：© 2026 {{site_name}} · support@example.com',
      smtpSaveBtn: '儲存 SMTP 設定',
      smtpSavingBtn: '儲存中…',
      smtpSavedMsg: 'SMTP 設定已儲存',
      smtpTestEmailLabel: '測試收件信箱',
      smtpTestBtn: '寄送測試郵件',
      smtpTestingBtn: '寄送中…',
      smtpTestSentMsg: '測試郵件已寄出，請檢查收件匣',
      smtpTemplatesToggle: '郵件通知範本與多語言實圖預覽（註冊 / 異常登入 / 重設 / 邀請 / 下架）',
      smtpRegisterCodeTab: '註冊驗證碼',
      smtpLoginAnomalyTab: '異常登入 OTP',
      smtpInviteTab: '協作邀請',
      smtpResetTab: '密碼重設',
      smtpTakedownTab: '下架通知',
      smtpRegisterSubjectLabel: '註冊驗證碼主旨',
      smtpRegisterHtmlLabel: '註冊驗證碼 HTML 原始碼',
      smtpLoginAnomalySubjectLabel: '異常登入安全驗證主旨',
      smtpLoginAnomalyHtmlLabel: '異常登入安全驗證 HTML 原始碼',
      smtpAutoLocalePlaceholder: '留空則自動使用內建多語言範本（跟隨用戶站點語言與站點 LOGO）',
      smtpPreviewLocaleLabel: '預覽語言',
      smtpInviteSubjectLabel: '協作邀請主旨',
      smtpInviteHtmlLabel: '協作邀請 HTML 原始碼',
      smtpResetSubjectLabel: '密碼重設主旨',
      smtpResetHtmlLabel: '密碼重設 HTML 原始碼',
      smtpTakedownSubjectLabel: '文章下架通知主旨',
      smtpTakedownHtmlLabel: '文章下架通知 HTML 原始碼',
      smtpTemplatePreviewTab: '即時效果預覽',
      smtpTemplateSourceTab: 'HTML 原始碼',
      smtpPreviewSubjectPrefix: '主旨：',
      smtpViewportDesktop: '桌面 560px',
      smtpViewportMobile: '手機 375px',
      smtpPreviewLoading: '正在渲染郵件預覽…',
      smtpResetDefaultBtn: '還原預設範本',
      smtpVarsHint: '支援變數：{{site_name}}、{{logo_html}}、{{email}}、{{code}}、{{ip_address}}、{{device_label}}、{{anomaly_summary}}、{{occurred_at}}、{{inviter_name}}、{{recipient_name}}、{{article_title}}、{{reason}}、{{expires_minutes}}、{{action_url}}',
      copyCallbackBtn: '複製回呼網址',
      copiedMsg: '已複製到剪貼簿',
      logoUploadedMsg: '站點 LOGO 已上傳，記得儲存設定',
      oauthSecretSavedMsg: 'OAuth Client Secret 已更新',
      oauthSecretClearedMsg: 'OAuth Client Secret 已清除',
    },
    studio: {
      autoReadMinutesBadge: (mins) => `約 ${mins} 分鐘`,
      autoVersionBadge: (ver) => `自動版本 v${ver}`,
      collabSectionTitle: '共創作者與協作邀請',
      authorsLabel: '文章作者',
      ownerBadge: '主作者',
      coAuthorBadge: '協作者',
      removeCollaboratorBtn: '移除',
      collaboratorRemovedMsg: '已移除協作者',
      inviteEmailPlaceholder: '輸入協作者信箱…',
      inviteBtn: '發送邀請',
      invitingBtn: '邀請中…',
      inviteCreatedEmailSentMsg: '協作邀請郵件已寄出，亦可直接複製連結',
      inviteCreatedLinkOnlyMsg: '已產生邀請連結（未啟用 SMTP，請複製連結分享）',
      copyInviteLinkBtn: '複製邀請連結',
      pendingInvitesLabel: '待接受邀請',
      revokeInviteBtn: '撤銷',
      inviteRevokedMsg: '邀請已撤銷',
      takedownBannerTitle: '此文章已被管理員下架',
      takedownBannerMeta: (by, reason) => `處理人：${by || '管理員'} · 原因：${reason}`,
      takedownBtn: '下架文章',
      restoreBtn: '恢復上架',
      takedownDialogTitle: (title) => `下架文章「${title}」`,
      takedownReasonLabel: '下架原因（將顯示給作者並寄送通知郵件）',
      takedownReasonPlaceholder: '請說明下架或需整改原因…',
      takedownConfirmBtn: '確認下架',
      takedownSuccessMsg: (emailsSent) =>
        emailsSent > 0 ? `文章已下架，已寄送 ${emailsSent} 封通知郵件` : '文章已下架',
      restoredSuccessMsg: '文章已恢復上架',
      takenDownBadge: '已下架',
      deleteTrackBtn: '刪除專題',
      deleteChapterBtn: '刪除章節',
      deleteTrackDialogTitle: (slug) => `刪除專題「${slug}」？`,
      deleteTrackDialogDesc: '此操作將永久移除該專題與底下所有章節及文章檔案。',
      deleteChapterDialogTitle: (slug) => `刪除章節「${slug}」？`,
      deleteChapterDialogDesc: '此操作將永久移除該章節與底下所有文章檔案。',
      trackDeletedMsg: '專題已刪除',
      chapterDeletedMsg: '章節已刪除',
      imageUploadedMsg: '圖片已上傳並插入',
      editorVisualMode: '視覺化檢視',
      editorSourceMode: '原始碼',
      editorPreviewToggle: '即時預覽',
      editorInspectorToggle: '文章資訊',
      editorInspectorTitle: '文章資訊欄',
      editorCloseInspectorAria: '收合文章資訊欄',
      editorToolbarAria: '編輯工具列',
      editorStatusSection: '發佈與狀態',
      editorMetaSection: '中繼資料與分類',
      editorStatusPublished: '已發佈',
      editorStatusDraft: '草稿',
      editorCanvasTitlePlaceholder: '在此輸入文章標題…',
    },
    users: {
      createUserBtn: '+ 新增用戶',
      createUserTitle: '建立新用戶帳號',
      usernameLabel: '用戶名',
      displayNameLabel: '顯示名稱',
      emailLabel: '電子郵件',
      roleLabel: '角色',
      passwordLabel: '初始密碼（至少 8 位）',
      createSubmitBtn: '建立用戶',
      userCreatedMsg: '用戶已建立',
      colStatus: '狀態',
      colActions: '操作',
      statusActive: '正常',
      statusBanned: '已停權',
      banBtn: '停權',
      unbanBtn: '解除停權',
      banDialogTitle: (name) => `停權用戶「${name}」`,
      banReasonLabel: '停權原因（選填）',
      banReasonPlaceholder: '例如：違反社群規範…',
      banConfirmBtn: '確認停權',
      userBannedMsg: '用戶已停權並撤銷工作階段',
      userUnbannedMsg: '用戶已解除停權',
      resetPwBtn: '重設密碼',
      resetPwDialogTitle: (name) => `重設「${name}」的密碼`,
      resetPwInputLabel: '新密碼（至少 8 位）',
      resetPwConfirmBtn: '確認重設',
      userPwResetMsg: '用戶密碼已重設',
      deleteUserBtn: '刪除',
      deleteUserDialogTitle: (name) => `永久刪除用戶「${name}」？`,
      deleteUserDialogDesc: '將永久移除此用戶帳號與登入工作階段。',
      userDeletedMsg: '用戶已刪除',
    },
    reader: {
      authorsPrefix: '作者',
      coAuthorsMore: (count) => `共 ${count} 位作者`,
    },
  },
  ja: {
    auth: {
      accountRoleLabel: 'アカウント種別',
      roleReader: '読者',
      roleAuthor: '執筆者',
      roleReaderHint: '記事の閲覧・メモ・進捗管理',
      roleAuthorHint: 'スタジオで記事を執筆・公開可能',
      forgotPasswordLink: 'パスワードをお忘れですか？',
      forgotPasswordTitle: 'パスワード再設定',
      forgotPasswordDesc: '登録メールアドレスを入力すると、6 桁の確認コードと再設定リンクを送信します。',
      sendResetBtn: '再設定コードを送信',
      sendingResetBtn: '送信中…',
      resetEmailSentMsg: '登録済みのメールアドレスであれば確認コードを送信しました',
      backToSignIn: 'サインインへ戻る',
      resetPasswordTitle: '新しいパスワードを設定',
      newPasswordLabel: '新しいパスワード（8文字以上）',
      confirmPasswordLabel: '新しいパスワード（確認）',
      passwordMismatchMsg: 'パスワードが一致しません',
      resetSubmitBtn: 'パスワードを再設定してログイン',
      resetSuccessMsg: 'パスワードを更新しサインインしました',
      onboardingTitle: (provider) => `${provider} アカウント連携`,
      onboardingRegisterTab: '新規アカウント作成',
      onboardingBindTab: '既存アカウントに連携',
      onboardingBindDesc: '既存のアカウントとパスワードで認証し、この OAuth ID を紐付けます。',
      onboardingBindBtn: '認証して連携',
      onboardingCreateBtn: '登録してサインイン',
      onboardingAvatarLabel: 'アバターの選択',
      oauthBoundSuccessMsg: 'OAuth アカウントを連携しました',
      signedInWelcomeMsg: (name) => `おかえりなさい、${name} さん`,
      registeredWelcomeMsg: (name) => `ようこそ、${name} さん`,
      signedOutMsg: 'サインアウトしました',
      collabAcceptedMsg: '共同執筆の招待を承認しました',
      collabLoginRequiredMsg: '共同執筆の招待を承認するにはサインインまたは登録してください',
      verificationCodeLabel: 'メール確認コード',
      verificationCodePlaceholder: '6 桁の確認コード',
      sendCodeBtn: 'コードを送信',
      sendingCodeBtn: '送信中…',
      resendCodeCountdown: (seconds) => `${seconds}秒後に再送`,
      codeSentToast: (email) => `${email} に確認コードを送信しました（10分間有効）`,
      backToHome: 'ホームへ戻る',
      authStepAccount: 'アカウント情報',
      authStepEmail: 'メール入力',
      authStepVerifyOtp: 'メール OTP 認証',
      authStepNewPassword: '新しいパスワード',
      continueToOtpBtn: 'コードを送信して次へ',
      verifyOtpContinueBtn: 'コードを認証して次へ',
      editDetailsBackBtn: '入力内容を変更',
      changeEmailBtn: 'メール変更',
      resendOtpBtn: 'コードを再送',
      otpInputAria: '6 桁のワンタイム確認コード',
      otpSentSubtitle: (target) => `${target} に送信された 6 桁の確認コードを入力してください：`,
      resetStep2Desc: (target) =>
        target
          ? `${target} に送信された 6 桁の再設定コードを入力して認証を完了してください：`
          : '登録メールアドレスとメールに届いた 6 桁コードを入力して認証してください：',
      resetStep3VerifiedBadge: 'メール OTP 認証が完了しました。新しいパスワードを設定してください',
      verifyAndSignInBtn: '認証してサインイン',
      verifyAndRegisterBtn: '認証して登録を完了',
      anomalyTitle: '通常と異なる場所または新しい端末からのサインイン',
      anomalyDescNewIp: '普段とは異なる IP アドレスからのサインインが検出されました。メール確認コードを入力してください。',
      anomalyDescNewDevice: '未登録の端末またはブラウザからのサインインが検出されました。メール確認コードを入力してください。',
      anomalyDescBoth: '新しい IP アドレスと新しい端末からのサインインが検出されました。メール確認コードを入力してください。',
      anomalyIpLabel: '検出 IP',
      anomalyDeviceLabel: '端末情報',
      resetOtpHint: '6 桁のメール確認コードを認証すると、新しいパスワードを設定できます。',
      haveResetCodeBtn: 'すでにコードをお持ちですか？直接入力する',
      loginSubtitle: 'サインインして読書メモ・学習進捗・スタジオを同期します。',
      registerSubtitle: '6 桁のメール OTP 認証でアカウントを作成します。',
      noAccountPrompt: 'アカウントをお持ちでないですか？',
      goToRegisterLink: '新規登録 →',
      hasAccountPrompt: 'すでにアカウントをお持ちですか？',
      goToLoginLink: 'サインイン',
      passwordToggleWarning: '注意：パスワードが画面上に表示されます。',
      passwordRuleHint: '8 文字以上。パスワードマネージャーからの貼り付けに対応しています。',
      usernameRuleHint: '3〜32 文字の英数字、アンダースコア、ハイフン。',
      usernameChecking: 'ユーザー名を確認中…',
      usernameAvailable: 'このユーザー名は利用できます',
      usernameTaken: 'このユーザー名はすでに使用されています',
      usernameInvalidFormat: '3〜32 文字の英数字・アンダースコア・ハイフンのみ使用可能',
      pwStrengthLabel: 'パスワード強度',
      pwStrengthIdle: '未入力',
      pwStrengthWeak: '弱い',
      pwStrengthFair: '普通',
      pwStrengthGood: '強い',
      pwStrengthStrong: '非常に強い',
      pwStrengthAdvisory: '目安のみ（保存を制限しません）· 大小文字・数字・記号の組み合わせ推奨',
      securityFooterNote: '',
      stepProgressAria: '認証ステップの進捗',
      errorPrefixLabel: 'エラー',
      errIdentifierRequired: 'ユーザー名またはメールアドレスを入力してください。',
      errUsernameInvalid: 'ユーザー名は 3 文字以上で入力してください。',
      errEmailInvalid: 'you@example.com の形式でメールアドレスを入力してください。',
      errPasswordLength: 'パスワードは 8 文字以上で入力してください。',
      errOtpLength: 'メールに届いた 6 桁の確認コードを入力してください。',
    },
    profile: {
      menuItem: 'プロフィールとセキュリティ',
      title: 'プロフィールとセキュリティ',
      tabProfile: 'プロフィール・アバター',
      tabSecurity: 'セキュリティ・連携',
      tabSessions: '端末とセッション',
      sessionsTitle: 'サインイン中の端末とセッション',
      sessionsDesc: 'サインイン時の IP アドレスと端末情報を記録します。心当たりのない端末はいつでもサインアウトでき、新しい IP や端末からのログイン時は OTP 認証が求められます。',
      sessionsEmpty: '他にアクティブなセッションはありません',
      sessionCurrentBadge: '現在の端末',
      sessionIpLabel: 'IP',
      sessionLastSeenLabel: '最終利用',
      sessionCreatedLabel: 'サインイン日時',
      sessionRevokeBtn: 'サインアウト',
      sessionRevokeOthersBtn: '他の端末をすべてサインアウト',
      sessionRevokedMsg: '対象セッションを終了しました',
      sessionOthersRevokedMsg: (count) =>
        count > 0 ? `他 ${count} 台の端末をサインアウトしました` : '他にアクティブな端末はありません',
      displayNameLabel: '表示名',
      bioLabel: '自己紹介',
      bioPlaceholder: '簡単な自己紹介を入力…',
      avatarSourceLabel: 'アバターのソース',
      avatarDefault: 'デフォルトアイコン',
      avatarGravatar: 'Gravatar',
      avatarOAuth: 'OAuth アバター',
      avatarUpload: '画像をアップロード',
      uploadAvatarBtn: 'アバターをアップロード',
      uploadingAvatarBtn: 'アップロード中…',
      saveProfileBtn: 'プロフィールを保存',
      savingProfileBtn: '保存中…',
      profileSavedMsg: 'プロフィールを更新しました',
      oauthLinkTitle: '外部 OAuth 連携',
      oauthLinkedBadge: (provider) => `${provider} 連携済み`,
      oauthNotLinkedText: '外部 OAuth アカウントは未連携です',
      oauthBindBtn: (provider) => `${provider} を連携する`,
      changePasswordTitle: 'パスワード変更',
      currentPasswordLabel: '現在のパスワード（未設定時は空欄）',
      newPasswordLabel: '新しいパスワード（8文字以上）',
      confirmPasswordLabel: '新しいパスワード（確認）',
      changePasswordBtn: 'パスワードを更新',
      changingPasswordBtn: '更新中…',
      passwordChangedMsg: 'パスワードを変更しました',
    },
    settings: {
      allowAuthorRegistrationLabel: '新規登録時に執筆者ロールの選択を許可する',
      gravatarBaseUrlLabel: 'Gravatar ミラー / ベース URL',
      gravatarBaseUrlPlaceholder: 'https://www.gravatar.com/avatar',
      smtpGroup: 'SMTP メールと通知テンプレート',
      smtpEnabledLabel: 'SMTP メール送信を有効化（登録確認コード・招待・再設定・公開停止通知）',
      smtpHostLabel: 'SMTP ホスト',
      smtpPortLabel: 'ポート',
      smtpEncryptionLabel: '暗号化',
      smtpEncTls: '暗黙 TLS (465)',
      smtpEncStarttls: 'STARTTLS (587)',
      smtpEncNone: 'なし (25)',
      smtpUsernameLabel: 'SMTP ユーザー名',
      smtpPasswordLabel: 'SMTP パスワード',
      smtpPasswordSavedBadge: '保存済み',
      smtpClearPasswordBtn: 'クリア',
      smtpFromNameLabel: '差出人名',
      smtpFromEmailLabel: '差出人メールアドレス',
      smtpEmailFooterLabel: 'カスタムメールフッター（任意・{{site_name}} 対応）',
      smtpEmailFooterPlaceholder: '空欄で標準の多言語フッターを使用（例：© 2026 {{site_name}} · support@example.com）',
      smtpSaveBtn: 'SMTP 設定を保存',
      smtpSavingBtn: '保存中…',
      smtpSavedMsg: 'SMTP 設定を保存しました',
      smtpTestEmailLabel: 'テスト送信先メール',
      smtpTestBtn: 'テストメール送信',
      smtpTestingBtn: '送信中…',
      smtpTestSentMsg: 'テストメールを送信しました',
      smtpTemplatesToggle: 'メールテンプレートと多言語プレビュー（登録 / 異常ログイン / 再設定 / 招待 / 公開停止）',
      smtpRegisterCodeTab: '登録確認コード',
      smtpLoginAnomalyTab: '異常ログイン OTP',
      smtpInviteTab: '共同執筆招待',
      smtpResetTab: 'パスワード再設定',
      smtpTakedownTab: '公開停止通知',
      smtpRegisterSubjectLabel: '登録確認コード件名',
      smtpRegisterHtmlLabel: '登録確認コード HTML ソース',
      smtpLoginAnomalySubjectLabel: '異常ログイン確認コード件名',
      smtpLoginAnomalyHtmlLabel: '異常ログイン確認コード HTML ソース',
      smtpAutoLocalePlaceholder: '空欄にするとユーザーのサイト言語とサイトロゴに合わせた内蔵テンプレートを使用します',
      smtpPreviewLocaleLabel: 'プレビュー言語',
      smtpInviteSubjectLabel: '招待メール件名',
      smtpInviteHtmlLabel: '招待メール HTML ソース',
      smtpResetSubjectLabel: '再設定メール件名',
      smtpResetHtmlLabel: '再設定メール HTML ソース',
      smtpTakedownSubjectLabel: '公開停止通知件名',
      smtpTakedownHtmlLabel: '公開停止通知 HTML ソース',
      smtpTemplatePreviewTab: 'プレビュー',
      smtpTemplateSourceTab: 'HTML ソース',
      smtpPreviewSubjectPrefix: '件名：',
      smtpViewportDesktop: 'デスクトップ 560px',
      smtpViewportMobile: 'モバイル 375px',
      smtpPreviewLoading: 'プレビューを描画中…',
      smtpResetDefaultBtn: 'デフォルトに戻す',
      smtpVarsHint: '変数：{{site_name}}, {{logo_html}}, {{email}}, {{code}}, {{ip_address}}, {{device_label}}, {{anomaly_summary}}, {{occurred_at}}, {{inviter_name}}, {{recipient_name}}, {{article_title}}, {{reason}}, {{expires_minutes}}, {{action_url}}',
      copyCallbackBtn: 'コールバック URL をコピー',
      copiedMsg: 'クリップボードにコピーしました',
      logoUploadedMsg: 'ロゴをアップロードしました（設定を保存してください）',
      oauthSecretSavedMsg: 'OAuth クライアントシークレットを保存しました',
      oauthSecretClearedMsg: 'OAuth クライアントシークレットを削除しました',
    },
    studio: {
      autoReadMinutesBadge: (mins) => `約 ${mins} 分`,
      autoVersionBadge: (ver) => `自動 v${ver}`,
      collabSectionTitle: '共同執筆者と招待',
      authorsLabel: '執筆者',
      ownerBadge: '主著者',
      coAuthorBadge: '共同執筆者',
      removeCollaboratorBtn: '削除',
      collaboratorRemovedMsg: '共同執筆者を削除しました',
      inviteEmailPlaceholder: '招待するメールアドレス…',
      inviteBtn: '招待を送信',
      invitingBtn: '送信中…',
      inviteCreatedEmailSentMsg: '招待メールを送信しました（リンクのコピーも可能です）',
      inviteCreatedLinkOnlyMsg: '招待リンクを作成しました（SMTP 未設定のためリンクを共有してください）',
      copyInviteLinkBtn: '招待リンクをコピー',
      pendingInvitesLabel: '保留中の招待',
      revokeInviteBtn: '取消',
      inviteRevokedMsg: '招待を取り消しました',
      takedownBannerTitle: 'この記事は管理者により公開停止されています',
      takedownBannerMeta: (by, reason) => `実行者：${by || '管理者'} · 理由：${reason}`,
      takedownBtn: '公開停止',
      restoreBtn: '公開を再開',
      takedownDialogTitle: (title) => `記事「${title}」を公開停止`,
      takedownReasonLabel: '公開停止の理由（執筆者に表示・通知されます）',
      takedownReasonPlaceholder: '理由を入力してください…',
      takedownConfirmBtn: '公開停止を実行',
      takedownSuccessMsg: (emailsSent) =>
        emailsSent > 0 ? `記事を公開停止しました（${emailsSent} 通通知済み）` : '記事を公開停止しました',
      restoredSuccessMsg: '記事の公開を再開しました',
      takenDownBadge: '公開停止中',
      deleteTrackBtn: 'トラック削除',
      deleteChapterBtn: 'チャプター削除',
      deleteTrackDialogTitle: (slug) => `トラック「${slug}」を削除しますか？`,
      deleteTrackDialogDesc: '配下の全チャプターと記事ファイルが完全に削除されます。',
      deleteChapterDialogTitle: (slug) => `チャプター「${slug}」を削除しますか？`,
      deleteChapterDialogDesc: '配下の全記事ファイルが完全に削除されます。',
      trackDeletedMsg: 'トラックを削除しました',
      chapterDeletedMsg: 'チャプターを削除しました',
      imageUploadedMsg: '画像をアップロードして挿入しました',
      editorVisualMode: 'ビジュアル',
      editorSourceMode: 'ソースコード',
      editorPreviewToggle: 'プレビュー',
      editorInspectorToggle: '記事情報',
      editorInspectorTitle: '記事インスペクタ',
      editorCloseInspectorAria: '記事インスペクタを閉じる',
      editorToolbarAria: '編集ツールバー',
      editorStatusSection: '公開状態とバージョン',
      editorMetaSection: 'メタデータ',
      editorStatusPublished: '公開済み',
      editorStatusDraft: '下書き',
      editorCanvasTitlePlaceholder: '記事タイトルを入力…',
    },
    users: {
      createUserBtn: '+ ユーザー追加',
      createUserTitle: '新規ユーザーを作成',
      usernameLabel: 'ユーザー名',
      displayNameLabel: '表示名',
      emailLabel: 'メールアドレス',
      roleLabel: 'ロール',
      passwordLabel: '初期パスワード（8文字以上）',
      createSubmitBtn: '作成する',
      userCreatedMsg: 'ユーザーを作成しました',
      colStatus: '状態',
      colActions: '操作',
      statusActive: '有効',
      statusBanned: '停止中',
      banBtn: '停止',
      unbanBtn: '解除',
      banDialogTitle: (name) => `ユーザー「${name}」を停止`,
      banReasonLabel: '停止理由（任意）',
      banReasonPlaceholder: '理由を入力…',
      banConfirmBtn: '停止する',
      userBannedMsg: 'ユーザーを停止しました',
      userUnbannedMsg: 'ユーザーの停止を解除しました',
      resetPwBtn: 'PW再設定',
      resetPwDialogTitle: (name) => `「${name}」のパスワードを再設定`,
      resetPwInputLabel: '新しいパスワード（8文字以上）',
      resetPwConfirmBtn: '再設定する',
      userPwResetMsg: 'パスワードを再設定しました',
      deleteUserBtn: '削除',
      deleteUserDialogTitle: (name) => `ユーザー「${name}」を完全削除しますか？`,
      deleteUserDialogDesc: 'アカウントとセッションが完全に削除されます。',
      userDeletedMsg: 'ユーザーを削除しました',
    },
    reader: {
      authorsPrefix: '執筆',
      coAuthorsMore: (count) => `他 ${count} 名`,
    },
  },
};
