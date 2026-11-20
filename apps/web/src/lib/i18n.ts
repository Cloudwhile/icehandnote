import type {
  AlertKind,
  CodeCardStyle,
  LicenseId,
  LocaleCode,
  MarginStickerTag,
  StickerStyle,
  StickerTone,
} from './types';

export const LOCALES: { code: LocaleCode; short: string; label: string }[] = [
  { code: 'zh-CN', short: '简中', label: '简体中文' },
  { code: 'en', short: 'EN', label: 'English' },
  { code: 'zh-TW', short: '繁中', label: '繁體中文' },
  { code: 'ja', short: '日本語', label: '日本語' },
];

export type LocalePreference = 'auto' | LocaleCode;
const LOCALE_PREF_KEY = 'icehandnote_locale_pref';
const LEGACY_LOCALE_PREF_KEY = 'stepnote_locale_pref';

export function normalizeLocale(raw?: string): LocaleCode {
  if (raw === 'zh-CN' || raw === 'en' || raw === 'zh-TW' || raw === 'ja') {
    return raw;
  }
  return 'zh-CN';
}

export function getStoredLocalePreference(): LocalePreference {
  try {
    const raw =
      localStorage.getItem(LOCALE_PREF_KEY) ??
      localStorage.getItem(LEGACY_LOCALE_PREF_KEY);
    if (raw === 'auto' || raw === 'zh-CN' || raw === 'en' || raw === 'zh-TW' || raw === 'ja') {
      return raw;
    }
  } catch {
    // ignore storage restriction
  }
  return 'auto';
}

export function setStoredLocalePreference(pref: LocalePreference): void {
  try {
    localStorage.setItem(LOCALE_PREF_KEY, pref);
  } catch {
    // ignore storage restriction
  }
}

export function detectSystemLocale(
  enabledLocales: LocaleCode[],
  fallback: LocaleCode = 'zh-CN',
): LocaleCode {
  const allowed = enabledLocales.length > 0 ? enabledLocales : (['zh-CN', 'en', 'zh-TW', 'ja'] as LocaleCode[]);
  const candidates: string[] = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      candidates.push(...navigator.languages);
    } else if (navigator.language) {
      candidates.push(navigator.language);
    }
  }

  for (const tag of candidates) {
    const lower = tag.toLowerCase();
    let mapped: LocaleCode | null = null;
    if (lower.startsWith('zh')) {
      if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo') || lower.includes('hant')) {
        mapped = 'zh-TW';
      } else {
        mapped = 'zh-CN';
      }
    } else if (lower.startsWith('ja')) {
      mapped = 'ja';
    } else if (lower.startsWith('en')) {
      mapped = 'en';
    }
    if (mapped && allowed.includes(mapped)) {
      return mapped;
    }
  }

  return allowed.includes(fallback) ? fallback : allowed[0];
}

export function resolvePreferredLocale(
  enabledLocales: LocaleCode[],
  fallback: LocaleCode = 'zh-CN',
): LocaleCode {
  const allowed = enabledLocales.length > 0 ? enabledLocales : (['zh-CN', 'en', 'zh-TW', 'ja'] as LocaleCode[]);
  const pref = getStoredLocalePreference();
  if (pref !== 'auto' && allowed.includes(pref)) {
    return pref;
  }
  return detectSystemLocale(allowed, fallback);
}

export interface AuthMessages {
  title: string;
  close: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  showPassword: string;
  hidePassword: string;
  submitting: string;
  submitBtn: string;
  loginFailed: string;
  ssoFailed: string;
  blogSsoLink: string;
}

export interface StudioSettingsMessages {
  title: string;
  generalGroup: string;
  siteNameLabel: string;
  brandBadgeLabel: string;
  brandBadgePlaceholder: string;
  heroTitleLabel: string;
  heroTaglineLabel: string;
  heroTaglinePlaceholder: string;
  footerTextLabel: string;
  footerTextPlaceholder: string;
  defaultAuthorLabel: string;
  defaultAuthorPlaceholder: string;
  defaultLicenseLabel: string;
  localeThemeGroup: string;
  defaultLocaleLabel: string;
  enabledLocalesLabel: string;
  defaultThemeLabel: string;
  themeSystem: string;
  themeDark: string;
  themeLight: string;
  featuresGroup: string;
  enableMarginNotesLabel: string;
  enableLikesLabel: string;
  enableProgressLabel: string;
  enableDraftAutosaveLabel: string;
  draftAutosaveIntervalLabel: string;
  autosaveIntervalOption: (secs: number) => string;
  integrationGroup: string;
  blogOriginUrlLabel: string;
  blogNavLabelLabel: string;
  blogNavLabelPlaceholder: string;
  ssoQueryParamLabel: string;
  ssoEnabledLabel: string;
  resetBtn: string;
  savingBtn: string;
  saveBtn: string;
  savedMsg: string;
  saveFailedMsg: (msg: string) => string;
  minOneLocaleError: string;
  updateGroup: string;
  currentVersionLabel: string;
  latestVersionLabel: string;
  checkUpdateBtn: string;
  checkingUpdateBtn: string;
  upToDateBadge: string;
  updateAvailableBadge: (ver: string) => string;
  viewReleaseLink: string;
  updateCheckFailed: string;
}

export interface StudioMessages {
  brandSuffix: string;
  backHomeTitle: string;
  navAriaLabel: string;
  sidebarAriaLabel: string;
  mobileDrawerAriaLabel: string;
  mobileDrawerTitle: string;
  closeDrawerAria: string;
  openNavAria: string;
  navBtnShort: string;
  expandSidebarAria: string;
  collapseSidebarAria: string;
  breadcrumbAria: string;
  localeGroupAria: string;
  frontpageLink: string;
  verifyingGate: string;
  unauthTitle: string;
  unauthDesc: string;
  unauthCta: string;
  readerGateTitle: (displayName: string) => string;
  readerGateDesc: string;
  readerGateCta: string;
  sections: {
    overview: string;
    editor: string;
    catalog: string;
    users: string;
    settings: string;
  };
  workbenchHeading: string;
  explorerHeading: string;
  addTrackShort: string;
  filterTreeAria: string;
  filterTreePlaceholder: string;
  addStepInChapterAria: (title: string) => string;
  addStepInChapterTitle: string;
  draftChip: string;
  hasDraftTitle: string;
  hasDriftTitle: string;
  noTreeMatches: (query: string) => string;
  pgConnected: string;
  localSeedMode: string;
  localesUnit: (n: number) => string;
  languageLabel: string;
  // Overview
  overviewTitle: string;
  startNewNoteCta: string;
  kpiRegionAria: string;
  kpiTracksLabel: string;
  kpiTracksSub: (chapters: number) => string;
  kpiStepsLabel: string;
  kpiStepsSub: (published: number, drafts: number) => string;
  kpiCoverageLabel: string;
  kpiResidentsLabel: string;
  kpiPendingLabel: string;
  kpiResidentsSub: (creators: number) => string;
  kpiPendingSub: string;
  queueTitle: string;
  queueCount: (n: number) => string;
  queueAllSyncedTitle: string;
  badgeDraft: string;
  badgeDrifted: (synced: number, canonical: number) => string;
  badgeMissing: string;
  actionContinueDraft: string;
  actionSyncDrift: string;
  actionAddTranslation: string;
  viewAllInMatrix: (n: number) => string;
  trackHealthTitle: string;
  manageMatrixLink: string;
  siteConfigCardTitle: string;
  openSettingsLink: string;
  configSiteName: string;
  configDefaultLocale: string;
  configEnabledLocales: string;
  configSsoStatus: string;
  configDraftAutosave: string;
  statusEnabled: string;
  statusDisabled: string;
  autosaveStatusOn: (secs: number) => string;
  autosaveStatusOff: string;
  autosavingNow: string;
  autosavedServer: (time: string) => string;
  autosavedLocal: (time: string) => string;
  autosaveFailed: string;
  draftRecoveryBanner: (time: string) => string;
  restoreDraftBtn: string;
  discardDraftBtn: string;
  configureAutosaveTitle: string;
  // Editor
  editorHeadingSr: string;
  stepTrackLabel: string;
  stepChapterLabel: string;
  stepSlugLabel: string;
  backToList: string;
  newStepToggle: string;
  createBtn: string;
  newStepOptionPrefix: string;
  editLocaleLabel: (canonical: number) => string;
  publishCheckbox: string;
  bumpCanonicalCheckbox: (cur: number, next: number) => string;
  deleteStepBtn: string;
  openReaderLink: string;
  savingBtn: string;
  saveBtn: (loc: string) => string;
  titleInputLabel: string;
  titleInputPlaceholder: string;
  stepNumLabel: string;
  minutesLabel: string;
  summaryInputLabel: string;
  summaryInputPlaceholder: string;
  licenseSelectLabel: string;
  licenseFollowSite: (code: string) => string;
  tagsInputLabel: string;
  snippetsHeading: string;
  markdownLabel: string;
  livePreviewBadge: (loc: string) => string;
  untitledPlaceholder: string;
  previewEmptyTitle: string;
  previewEmptyDesc: string;
  switchedNewStepBanner: (slug: string) => string;
  missingTitleOrSlugBanner: string;
  savedBanner: (loc: string, rev: number, isDraft: boolean, time: string) => string;
  saveFailedBanner: (msg: string) => string;
  loadStepFailedBanner: (msg: string) => string;
  deletedBanner: (slug: string) => string;
  deleteFailedBanner: (msg: string) => string;
  trackCreatedBanner: (title: string) => string;
  trackCreateFailedBanner: (msg: string) => string;
  chapterCreatedBanner: (trackSlug: string) => string;
  chapterCreateFailedBanner: (msg: string) => string;
  // Catalog
  catalogTitle: string;
  catalogEmptyTitle: string;
  catalogEmptyDesc: string;
  addStepHereBtn: string;
  canonicalRevMeta: (rev: number) => string;
  addLocaleAction: string;
  draftParen: string;
  createTrackTitle: string;
  trackSlugLabel: string;
  trackSlugPlaceholder: string;
  trackTitleLabel: string;
  trackTitlePlaceholder: string;
  trackDescLabel: string;
  trackDescPlaceholder: string;
  difficultyLabel: string;
  firstChapterSlugLabel: string;
  firstChapterTitleLabel: string;
  createTrackSubmit: string;
  createChapterTitle: string;
  parentTrackLabel: string;
  chapterSlugLabel: string;
  chapterNumLabel: string;
  chapterTitleLabel: string;
  chapterTitlePlaceholder: string;
  createChapterSubmit: string;
  // Users
  usersTitle: string;
  roleCountAdmin: (n: number) => string;
  roleCountAuthor: (n: number) => string;
  roleCountReader: (n: number) => string;
  roleUpdatedFeedback: (username: string, role: string) => string;
  roleUpdateFailedFeedback: (msg: string) => string;
  colIdentity: string;
  colAuthSource: string;
  colRole: string;
  colWpId: string;
  changeRoleAria: (name: string) => string;
  roleOptReader: string;
  roleOptAuthor: string;
  roleOptAdmin: string;
  usersEmptyTitle: string;
  usersEmptyDesc: string;
  // Delete dialog
  deleteDialogAria: string;
  deleteDialogTitle: (slug: string) => string;
  deleteDialogDesc: string;
  deleteCancelBtn: string;
  deleteConfirmBtn: string;
  snippets: {
    steps: string;
    tip: string;
    note: string;
    info: string;
    warn: string;
    danger: string;
    margin: string;
    code: string;
    sketch: string;
  };
  visual: {
    modeAria: string;
    visualTab: string;
    markdownTab: string;
    addBlockLabel: string;
    insertBelow: string;
    emptyTitle: string;
    moveUp: string;
    moveDown: string;
    duplicate: string;
    deleteBlock: string;
    collapse: string;
    expand: string;
    blockCount: (n: number) => string;
    types: {
      heading: string;
      paragraph: string;
      steps: string;
      alert: string;
      code_card: string;
      list: string;
      quote: string;
      rough_diagram: string;
      raw_markdown: string;
    };
    headingPlaceholder: string;
    paragraphPlaceholder: string;
    marginNoteLabel: string;
    marginNotePlaceholder: string;
    stepsTitleLabel: string;
    stepsTitlePlaceholder: string;
    stepItemTitlePlaceholder: string;
    stepItemDetailPlaceholder: string;
    addStepItem: string;
    defaultCheckedTitle: string;
    alertKindLabel: string;
    stickerStyleLabel: string;
    stickerToneLabel: string;
    stickerAutoOption: string;
    stickerBadgePlaceholder: string;
    alertTitlePlaceholder: string;
    alertBodyPlaceholder: string;
    alertDetailSummaryPlaceholder: string;
    alertDetailBodyPlaceholder: string;
    codeStyleLabel: string;
    codeLangLabel: string;
    codeFilePlaceholder: string;
    codeBodyPlaceholder: string;
    listOrdered: string;
    listUnordered: string;
    listItemPlaceholder: string;
    addListItem: string;
    quotePlaceholder: string;
    diagramCaptionPlaceholder: string;
    diagramNodesHeading: string;
    diagramEdgesHeading: string;
    diagramAddNode: string;
    diagramAddEdge: string;
    diagramAutoLayout: string;
    diagramNodeLabelPlaceholder: string;
    diagramNodeSubPlaceholder: string;
    diagramEdgeLabelPlaceholder: string;
    fmtBold: string;
    fmtItalic: string;
    fmtCode: string;
    fmtLink: string;
  };
  settings: StudioSettingsMessages;
}

export interface UiMessages {
  brandName: string;
  navHome: string;
  navStudio: string;
  navPrimaryAria: string;
  navMenuAria: string;
  navLanguageAria: string;
  followSystemLocale: string;
  otherSeriesHeading: string;
  taskScopeLabel: string;
  taskScopeSection: string;
  taskScopeParagraph: string;
  sectionTaskToggleLabel: string;
  sectionTaskCompleteBtn: string;
  sectionTaskCompletedBadge: string;
  sectionTaskDoneShort: string;
  loginPassportBtn: string;
  logoutBtn: string;
  searchPlaceholder: string;
  searchTrigger: string;
  searchTitle: string;
  searchEmptyTitle: string;
  searchEmptyBody: string;
  closeLabel: string;
  themeDarkLabel: string;
  themeLightLabel: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  tracksHeading: string;
  tracksEmptyTitle: string;
  tracksEmptyBody: string;
  loadErrorTitle: string;
  loadErrorBody: string;
  retryBtn: string;
  openNotebook: string;
  chaptersUnit: string;
  stepsUnit: string;
  formatTrackCounts: (chapters: number, steps: number) => string;
  minutesUnit: string;
  tocButton: string;
  tocHeading: string;
  chapterDrawerButton: string;
  chapterOutlineAria: string;
  stepProgressLabel: string;
  fallbackShortBadge: string;
  fallbackShortTitle: string;
  fallbackBannerTitle: string;
  fallbackBannerBody: (resolved: string) => string;
  driftBannerTitle: string;
  driftBannerBody: (synced: number, canonical: number) => string;
  switchCanonicalCta: (canonical: number) => string;
  stepNotFoundTitle: string;
  stepNotFoundBody: string;
  pageNotFoundTitle: string;
  pageNotFoundBody: string;
  backHomeCta: string;
  addStickyBtn: string;
  stickyPlaceholder: string;
  saveStickyBtn: string;
  cancelBtn: string;
  deleteStickyAria: string;
  stickyColorAria: (color: string) => string;
  jumpToSectionAria: (text: string) => string;
  authorNoteBadge: string;
  myNoteBadge: string;
  copyCode: string;
  copiedCode: string;
  copyFailedCode: string;
  prevStep: string;
  nextStepPrimary: string;
  finishTrackPrimary: string;
  markCompleted: string;
  completedBadge: string;
  likeStep: string;
  stepsDefaultTitle: string;
  stepsProgressLabel: (done: number, total: number) => string;
  stepsAllDoneBadge: string;
  stepsResetBtn: string;
  articleTasksLabel: string;
  difficultyLabels: Record<string, string>;
  alertStamps: Record<AlertKind, string>;
  stickerStyles: Record<StickerStyle, string>;
  stickerTones: Record<StickerTone, string>;
  codeCardStyles: Record<CodeCardStyle, string>;
  marginTags: Record<MarginStickerTag, string>;
  licenseBadge: string;
  licenseDeedLink: string;
  licenseNames: Record<LicenseId, string>;
  auth: AuthMessages;
  studio: StudioMessages;
}

export const UI_COPY: Record<LocaleCode, UiMessages> = {
  'zh-CN': {
    brandName: 'IceHandnote',
    navHome: '首页',
    navStudio: '后台',
    navPrimaryAria: '主导航',
    navMenuAria: '菜单',
    navLanguageAria: '语言',
    followSystemLocale: '跟随系统',
    otherSeriesHeading: '其他系列',
    taskScopeLabel: '任务类型',
    taskScopeSection: '节任务',
    taskScopeParagraph: '段任务',
    sectionTaskToggleLabel: '设为节任务',
    sectionTaskCompleteBtn: '完成本节',
    sectionTaskCompletedBadge: '已完成本节',
    sectionTaskDoneShort: '已完成',
    loginPassportBtn: '登录',
    logoutBtn: '退出',
    searchPlaceholder: '搜索笔记与文章…',
    searchTrigger: '搜索',
    searchTitle: '搜索文章',
    searchEmptyTitle: '无匹配结果',
    searchEmptyBody: '',
    closeLabel: '关闭',
    themeDarkLabel: '深色',
    themeLightLabel: '浅色',
    heroPrimaryCta: '开始阅读 →',
    heroSecondaryCta: '搜索 (⌘K)',
    tracksHeading: '专题',
    tracksEmptyTitle: '暂无专题',
    tracksEmptyBody: '',
    loadErrorTitle: '加载失败',
    loadErrorBody: '',
    retryBtn: '重试',
    openNotebook: '阅读 →',
    chaptersUnit: '章',
    stepsUnit: '篇',
    formatTrackCounts: (chapters, steps) => `${chapters} 章 · ${steps} 篇`,
    minutesUnit: '分钟',
    tocButton: '目录',
    tocHeading: '本文目录',
    chapterDrawerButton: '章节',
    chapterOutlineAria: '章节目录',
    stepProgressLabel: '进度',
    fallbackShortBadge: '原文',
    fallbackShortTitle: '回退显示原文',
    fallbackBannerTitle: '暂无该语言版本',
    fallbackBannerBody: (resolved) => `当前显示 ${resolved} 原文版本。`,
    driftBannerTitle: '翻译版本已落后',
    driftBannerBody: (synced, canonical) =>
      `原文已更新至 v${canonical}，当前译文仍为 v${synced}。`,
    switchCanonicalCta: (canonical) => `查看原文 v${canonical}`,
    stepNotFoundTitle: '找不到此页面',
    stepNotFoundBody: '',
    pageNotFoundTitle: '页面不存在（404）',
    pageNotFoundBody: '',
    backHomeCta: '返回首页',
    addStickyBtn: '+ 笔记',
    stickyPlaceholder: '输入笔记…',
    saveStickyBtn: '保存',
    cancelBtn: '取消',
    deleteStickyAria: '删除笔记',
    stickyColorAria: (color) => `颜色：${color}`,
    jumpToSectionAria: (text) => `跳转至 ${text}`,
    authorNoteBadge: '作者批注',
    myNoteBadge: '我的笔记',
    copyCode: '复制',
    copiedCode: '已复制',
    copyFailedCode: '复制失败',
    prevStep: '← 上一篇',
    nextStepPrimary: '下一篇 →',
    finishTrackPrimary: '返回专题首页 →',
    markCompleted: '标记已读',
    completedBadge: '✓ 已读',
    likeStep: '赞',
    stepsDefaultTitle: '实践任务',
    stepsProgressLabel: (done, total) => `已完成 ${done} / ${total}`,
    stepsAllDoneBadge: '✓ 全部任务已完成',
    stepsResetBtn: '重置勾选',
    articleTasksLabel: '本文任务',
    difficultyLabels: {
      beginner: '入门',
      intermediate: '进阶',
      advanced: '架构',
    },
    alertStamps: {
      tip: '小贴士',
      note: '笔记',
      info: '说明',
      idea: '灵感',
      question: '思考',
      check: '要点',
      bookmark: '索引',
      warning: '注意',
      danger: '警示',
    },
    stickerStyles: {
      tape: '胶带贴',
      pin: '图钉卡',
      torn: '手撕签',
      clip: '回形针',
      stamp: '邮票章',
      looseleaf: '活页纸',
      tag: '书签牌',
    },
    stickerTones: {
      amber: '暖黄',
      mint: '薄荷',
      ice: '冰青',
      violet: '暮紫',
      coral: '珊瑚',
      kraft: '牛皮纸',
    },
    codeCardStyles: {
      washi: '胶带方格',
      spiral: '线圈横格',
      index: '索引卡',
      torn: '手撕草稿',
    },
    marginTags: {
      note: '笔记',
      idea: '灵感',
      ask: '疑问',
      star: '重点',
      todo: '待办',
    },
    licenseBadge: '许可协议',
    licenseDeedLink: '查看条款 ↗',
    licenseNames: {
      'cc-by-4.0': 'CC BY 4.0 · 署名',
      'cc-by-sa-4.0': 'CC BY-SA 4.0 · 署名-相同方式共享',
      'cc-by-nc-4.0': 'CC BY-NC 4.0 · 署名-非商业性使用',
      'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0 · 署名-非商业性使用-相同方式共享',
      'cc-by-nd-4.0': 'CC BY-ND 4.0 · 署名-禁止演绎',
      'cc-by-nc-nd-4.0': 'CC BY-NC-ND 4.0 · 署名-非商业性使用-禁止演绎',
      'cc0-1.0': 'CC0 1.0 · 公有领域',
      'all-rights-reserved': '保留所有权利',
      none: '不显示',
    },
    auth: {
      title: '登录',
      close: '关闭',
      identifierLabel: '用户名或邮箱',
      identifierPlaceholder: '',
      passwordLabel: '密码',
      passwordPlaceholder: '',
      showPassword: '显示',
      hidePassword: '隐藏',
      submitting: '登录中…',
      submitBtn: '登录',
      loginFailed: '用户名或密码错误',
      ssoFailed: 'SSO 验证失败',
      blogSsoLink: '使用主站账号登录 ↗',
    },
    studio: {
      brandSuffix: '后台',
      backHomeTitle: '返回前台',
      navAriaLabel: '后台导航',
      sidebarAriaLabel: '侧边栏',
      mobileDrawerAriaLabel: '导航抽屉',
      mobileDrawerTitle: '后台导航',
      closeDrawerAria: '关闭',
      openNavAria: '打开导航',
      navBtnShort: '导航',
      expandSidebarAria: '展开侧边栏',
      collapseSidebarAria: '收起侧边栏',
      breadcrumbAria: '当前位置',
      localeGroupAria: '界面语言',
      frontpageLink: '前台 ↗',
      verifyingGate: '正在验证权限…',
      unauthTitle: '请先登录',
      unauthDesc: '需要作者或管理员权限才能访问后台。',
      unauthCta: '登录',
      readerGateTitle: (displayName) => `@${displayName} 当前为读者权限`,
      readerGateDesc: '需要作者或管理员权限才能进入后台。',
      readerGateCta: '返回前台',
      sections: {
        overview: '概览',
        editor: '编辑器',
        catalog: '内容目录',
        users: '用户权限',
        settings: '站点设置',
      },
      workbenchHeading: '工作台',
      explorerHeading: '目录',
      addTrackShort: '+ 新建专题',
      filterTreeAria: '筛选文章',
      filterTreePlaceholder: '筛选文章…',
      addStepInChapterAria: (title) => `在 ${title} 中新建文章`,
      addStepInChapterTitle: '新建文章',
      draftChip: '草稿',
      hasDraftTitle: '包含草稿',
      hasDriftTitle: '翻译待同步',
      noTreeMatches: (q) => `未找到包含“${q}”的内容`,
      pgConnected: 'PostgreSQL',
      localSeedMode: 'LocalSeed',
      localesUnit: (n) => `${n} 种语言`,
      languageLabel: '语言',
      overviewTitle: '概览',
      startNewNoteCta: '+ 新建文章',
      kpiRegionAria: '统计数据',
      kpiTracksLabel: '专题',
      kpiTracksSub: (ch) => `${ch} 个章节`,
      kpiStepsLabel: '文章',
      kpiStepsSub: (pub, drafts) => `已发布 ${pub} · 草稿 ${drafts}`,
      kpiCoverageLabel: '多语言覆盖率',
      kpiResidentsLabel: '用户',
      kpiPendingLabel: '待处理',
      kpiResidentsSub: (c) => `${c} 位创作者`,
      kpiPendingSub: '草稿与待翻译',
      queueTitle: '待处理的草稿与翻译',
      queueCount: (n) => `${n} 项`,
      queueAllSyncedTitle: '全部已同步',
      badgeDraft: '草稿',
      badgeDrifted: (s, c) => `v${s} < v${c}`,
      badgeMissing: '待翻译',
      actionContinueDraft: '继续编辑',
      actionSyncDrift: '更新翻译',
      actionAddTranslation: '补充翻译',
      viewAllInMatrix: (n) => `查看全部 ${n} 项 →`,
      trackHealthTitle: '各专题翻译进度',
      manageMatrixLink: '内容目录 →',
      siteConfigCardTitle: '站点配置',
      openSettingsLink: '设置 →',
      configSiteName: '站点名称',
      configDefaultLocale: '默认语言',
      configEnabledLocales: '已启用语言',
      configSsoStatus: '主站 SSO',
      configDraftAutosave: '草稿自动保存',
      statusEnabled: '已启用',
      statusDisabled: '已停用',
      autosaveStatusOn: (secs) => `自动保存 · 每 ${secs} 秒`,
      autosaveStatusOff: '自动保存已关闭',
      autosavingNow: '正在自动保存…',
      autosavedServer: (time) => `草稿已于 ${time} 自动保存`,
      autosavedLocal: (time) => `已于 ${time} 暂存到本地`,
      autosaveFailed: '自动保存失败',
      draftRecoveryBanner: (time) => `发现未保存的本地草稿（${time}）`,
      restoreDraftBtn: '恢复草稿',
      discardDraftBtn: '丢弃',
      configureAutosaveTitle: '前往站点设置调整自动保存策略',
      editorHeadingSr: '编辑器',
      stepTrackLabel: '专题',
      stepChapterLabel: '章节',
      stepSlugLabel: '文章 Slug',
      backToList: '返回列表',
      newStepToggle: '+ 新建文章',
      createBtn: '创建',
      newStepOptionPrefix: '[新建]',
      editLocaleLabel: (rev) => `编辑语言（主版本 v${rev}）`,
      publishCheckbox: '公开发布',
      bumpCanonicalCheckbox: (cur, next) => `升级主版本 (v${cur} → v${next})`,
      deleteStepBtn: '删除',
      openReaderLink: '预览 ↗',
      savingBtn: '保存中…',
      saveBtn: (loc) => `保存 (${loc})`,
      titleInputLabel: '标题',
      titleInputPlaceholder: '',
      stepNumLabel: '排序',
      minutesLabel: '分钟',
      summaryInputLabel: '摘要',
      summaryInputPlaceholder: '',
      licenseSelectLabel: '许可协议',
      licenseFollowSite: (code) => `跟随站点 (${code})`,
      tagsInputLabel: '标签',
      snippetsHeading: '快捷插入',
      markdownLabel: 'Markdown 源码',
      livePreviewBadge: (loc) => `实时预览 · ${loc}`,
      untitledPlaceholder: '未命名',
      previewEmptyTitle: '暂无内容',
      previewEmptyDesc: '',
      switchedNewStepBanner: (slug) => `已切换至新建文章：${slug}`,
      missingTitleOrSlugBanner: '请填写文章标题与 Slug',
      savedBanner: (loc, rev, isDraft, time) =>
        `已保存 ${loc} v${rev}（${isDraft ? '草稿' : '已发布'}）· ${time}`,
      saveFailedBanner: (msg) => `保存失败：${msg}`,
      loadStepFailedBanner: (msg) => `加载失败：${msg}`,
      deletedBanner: (slug) => `已删除 ${slug}`,
      deleteFailedBanner: (msg) => `删除失败：${msg}`,
      trackCreatedBanner: (title) => `已创建专题“${title}”`,
      trackCreateFailedBanner: (msg) => `创建失败：${msg}`,
      chapterCreatedBanner: (trackSlug) => `已在 ${trackSlug} 中新增章节`,
      chapterCreateFailedBanner: (msg) => `新增失败：${msg}`,
      catalogTitle: '专题与多语言目录',
      catalogEmptyTitle: '暂无专题',
      catalogEmptyDesc: '',
      addStepHereBtn: '+ 新建文章',
      canonicalRevMeta: (rev) => `v${rev}`,
      addLocaleAction: '+',
      draftParen: '草稿',
      createTrackTitle: '新建专题',
      trackSlugLabel: 'Slug',
      trackSlugPlaceholder: '',
      trackTitleLabel: '名称',
      trackTitlePlaceholder: '',
      trackDescLabel: '简介',
      trackDescPlaceholder: '',
      difficultyLabel: '难度',
      firstChapterSlugLabel: '首章 Slug',
      firstChapterTitleLabel: '首章标题',
      createTrackSubmit: '创建专题',
      createChapterTitle: '新增章节',
      parentTrackLabel: '所属专题',
      chapterSlugLabel: '章节 Slug',
      chapterNumLabel: '章号',
      chapterTitleLabel: '章节标题',
      chapterTitlePlaceholder: '',
      createChapterSubmit: '新增章节',
      usersTitle: '用户与角色权限',
      roleCountAdmin: (n) => `管理员 ${n}`,
      roleCountAuthor: (n) => `作者 ${n}`,
      roleCountReader: (n) => `读者 ${n}`,
      roleUpdatedFeedback: (u, r) => `已将 @${u} 的角色更新为 ${r}`,
      roleUpdateFailedFeedback: (msg) => `更新失败：${msg}`,
      colIdentity: '用户',
      colAuthSource: '登录来源',
      colRole: '角色',
      colWpId: 'WP ID',
      changeRoleAria: (name) => `调整 ${name} 的角色`,
      roleOptReader: 'reader',
      roleOptAuthor: 'author',
      roleOptAdmin: 'admin',
      usersEmptyTitle: '暂无用户记录',
      usersEmptyDesc: '',
      deleteDialogAria: '确认删除',
      deleteDialogTitle: (slug) => `确认删除“${slug}”？`,
      deleteDialogDesc: '此操作将永久移除该文章的所有语言版本与本地文件，且无法撤销。',
      deleteCancelBtn: '取消',
      deleteConfirmBtn: '永久删除',
      snippets: {
        steps: '+ 任务项',
        tip: '+ Tip',
        note: '+ Note',
        info: '+ Info',
        warn: '+ Warn',
        danger: '+ Danger',
        margin: '+ 批注',
        code: '+ 代码块',
        sketch: '+ 流程图',
      },
      visual: {
        modeAria: '编辑模式切换',
        visualTab: '可视化编辑',
        markdownTab: 'Markdown 源码',
        addBlockLabel: '插入内容块',
        insertBelow: '在下方插入',
        emptyTitle: '尚未添加内容',
        moveUp: '上移',
        moveDown: '下移',
        duplicate: '复制',
        deleteBlock: '删除',
        collapse: '折叠',
        expand: '展开',
        blockCount: (n) => `${n} 个区块`,
        types: {
          heading: '章节标题',
          paragraph: '正文段落',
          steps: '任务项',
          alert: '贴纸卡片',
          code_card: '代码卡',
          list: '列表',
          quote: '引用',
          rough_diagram: '流程图',
          raw_markdown: '原始 Markdown',
        },
        headingPlaceholder: '小节标题…',
        paragraphPlaceholder: '输入正文…',
        marginNoteLabel: '作者批注',
        marginNotePlaceholder: '批注…',
        stepsTitleLabel: '分组标题',
        stepsTitlePlaceholder: '',
        stepItemTitlePlaceholder: '任务内容…',
        stepItemDetailPlaceholder: '补充说明…',
        addStepItem: '添加子任务',
        defaultCheckedTitle: '默认勾选',
        alertKindLabel: '贴纸类型',
        stickerStyleLabel: '贴纸样式',
        stickerToneLabel: '纸张配色',
        stickerAutoOption: '默认',
        stickerBadgePlaceholder: '角标',
        alertTitlePlaceholder: '标题…',
        alertBodyPlaceholder: '内容…',
        alertDetailSummaryPlaceholder: '折叠标题…',
        alertDetailBodyPlaceholder: '折叠内容…',
        codeStyleLabel: '纸张样式',
        codeLangLabel: '语言',
        codeFilePlaceholder: '文件名',
        codeBodyPlaceholder: '代码…',
        listOrdered: '有序列表',
        listUnordered: '无序列表',
        listItemPlaceholder: '列表项…',
        addListItem: '添加列表项',
        quotePlaceholder: '引用内容…',
        diagramCaptionPlaceholder: '图表说明…',
        diagramNodesHeading: '节点',
        diagramEdgesHeading: '连线',
        diagramAddNode: '+ 节点',
        diagramAddEdge: '+ 连线',
        diagramAutoLayout: '自动排布',
        diagramNodeLabelPlaceholder: '节点名称',
        diagramNodeSubPlaceholder: '副标题',
        diagramEdgeLabelPlaceholder: '连线标签',
        fmtBold: '粗体',
        fmtItalic: '斜体',
        fmtCode: '代码',
        fmtLink: '链接',
      },
      settings: {
        title: '站点设置',
        generalGroup: '基本信息',
        siteNameLabel: '站点名称',
        brandBadgeLabel: '品牌徽章',
        brandBadgePlaceholder: '',
        heroTitleLabel: '首页标题',
        heroTaglineLabel: '首页副标题',
        heroTaglinePlaceholder: '',
        footerTextLabel: '页脚文案',
        footerTextPlaceholder: '',
        defaultAuthorLabel: '默认作者',
        defaultAuthorPlaceholder: '',
        defaultLicenseLabel: '默认许可协议',
        localeThemeGroup: '语言与外观',
        defaultLocaleLabel: '默认语言',
        enabledLocalesLabel: '启用语言',
        defaultThemeLabel: '默认主题',
        themeSystem: '跟随系统',
        themeDark: '深色',
        themeLight: '浅色',
        featuresGroup: '功能设置',
        enableMarginNotesLabel: '启用页边笔记',
        enableLikesLabel: '启用文章点赞',
        enableProgressLabel: '启用任务进度追踪',
        enableDraftAutosaveLabel: '启用草稿自动保存',
        draftAutosaveIntervalLabel: '自动保存间隔',
        autosaveIntervalOption: (secs) => `每 ${secs} 秒`,
        integrationGroup: '外部主站与 SSO',
        blogOriginUrlLabel: '外部主站地址',
        blogNavLabelLabel: '导航链接名称',
        blogNavLabelPlaceholder: '',
        ssoQueryParamLabel: 'SSO 参数名',
        ssoEnabledLabel: '启用跨站 SSO 登录',
        resetBtn: '重置',
        savingBtn: '保存中…',
        saveBtn: '保存设置',
        savedMsg: '设置已保存',
        saveFailedMsg: (msg) => `保存失败：${msg}`,
        minOneLocaleError: '请至少启用一种语言',
        updateGroup: '版本与更新',
        currentVersionLabel: '当前版本',
        latestVersionLabel: '最新版本',
        checkUpdateBtn: '检查更新',
        checkingUpdateBtn: '检查中…',
        upToDateBadge: '已是最新',
        updateAvailableBadge: (ver) => `新版本 ${ver}`,
        viewReleaseLink: '查看发行版 ↗',
        updateCheckFailed: '检查失败',
      },
    },
  },
  en: {
    brandName: 'IceHandnote',
    navHome: 'Home',
    navStudio: 'Studio',
    navPrimaryAria: 'Primary navigation',
    navMenuAria: 'Menu',
    navLanguageAria: 'Language',
    followSystemLocale: 'Follow System',
    otherSeriesHeading: 'Other Series',
    taskScopeLabel: 'Task Scope',
    taskScopeSection: 'Section Task',
    taskScopeParagraph: 'Paragraph Task',
    sectionTaskToggleLabel: 'Mark as Section Task',
    sectionTaskCompleteBtn: 'Mark section done',
    sectionTaskCompletedBadge: 'Section completed',
    sectionTaskDoneShort: 'Done',
    loginPassportBtn: 'Sign in',
    logoutBtn: 'Sign out',
    searchPlaceholder: 'Search articles & notes…',
    searchTrigger: 'Search',
    searchTitle: 'Search Articles',
    searchEmptyTitle: 'No results found',
    searchEmptyBody: '',
    closeLabel: 'Close',
    themeDarkLabel: 'Dark',
    themeLightLabel: 'Light',
    heroPrimaryCta: 'Start Reading →',
    heroSecondaryCta: 'Search (⌘K)',
    tracksHeading: 'Tracks',
    tracksEmptyTitle: 'No tracks yet',
    tracksEmptyBody: '',
    loadErrorTitle: 'Failed to load',
    loadErrorBody: '',
    retryBtn: 'Retry',
    openNotebook: 'Read →',
    chaptersUnit: 'chapters',
    stepsUnit: 'articles',
    formatTrackCounts: (chapters, steps) =>
      `${chapters} ${chapters === 1 ? 'chapter' : 'chapters'} · ${steps} ${steps === 1 ? 'article' : 'articles'}`,
    minutesUnit: 'min',
    tocButton: 'On this page',
    tocHeading: 'On this page',
    chapterDrawerButton: 'Chapters',
    chapterOutlineAria: 'Chapter outline',
    stepProgressLabel: 'Progress',
    fallbackShortBadge: 'SRC',
    fallbackShortTitle: 'Showing source edition',
    fallbackBannerTitle: 'Not yet translated',
    fallbackBannerBody: (resolved) => `Showing the ${resolved} source edition.`,
    driftBannerTitle: 'Translation outdated',
    driftBannerBody: (synced, canonical) =>
      `Source is at v${canonical}; this translation is at v${synced}.`,
    switchCanonicalCta: (canonical) => `View source v${canonical}`,
    stepNotFoundTitle: 'Article not found',
    stepNotFoundBody: '',
    pageNotFoundTitle: 'Page not found (404)',
    pageNotFoundBody: '',
    backHomeCta: 'Back to Home',
    addStickyBtn: '+ Note',
    stickyPlaceholder: 'Add a note…',
    saveStickyBtn: 'Save',
    cancelBtn: 'Cancel',
    deleteStickyAria: 'Delete note',
    stickyColorAria: (color) => `Color: ${color}`,
    jumpToSectionAria: (text) => `Jump to ${text}`,
    authorNoteBadge: 'Author Note',
    myNoteBadge: 'My Note',
    copyCode: 'Copy',
    copiedCode: 'Copied',
    copyFailedCode: 'Failed',
    prevStep: '← Previous',
    nextStepPrimary: 'Next Article →',
    finishTrackPrimary: 'Back to Tracks →',
    markCompleted: 'Mark Read',
    completedBadge: '✓ Read',
    likeStep: 'Like',
    stepsDefaultTitle: 'Hands-on Tasks',
    stepsProgressLabel: (done, total) => `${done} / ${total} done`,
    stepsAllDoneBadge: '✓ All tasks done',
    stepsResetBtn: 'Reset',
    articleTasksLabel: 'Article Tasks',
    difficultyLabels: {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
    },
    alertStamps: {
      tip: 'TIP',
      note: 'NOTE',
      info: 'INFO',
      idea: 'IDEA',
      question: 'Q&A',
      check: 'CHECK',
      bookmark: 'REF',
      warning: 'WARN',
      danger: 'DANGER',
    },
    stickerStyles: {
      tape: 'Washi Tape',
      pin: 'Pushpin',
      torn: 'Torn Slip',
      clip: 'Paperclip',
      stamp: 'Postmark',
      looseleaf: 'Loose-Leaf',
      tag: 'Tag',
    },
    stickerTones: {
      amber: 'Amber',
      mint: 'Mint',
      ice: 'Ice',
      violet: 'Violet',
      coral: 'Coral',
      kraft: 'Kraft',
    },
    codeCardStyles: {
      washi: 'Washi Grid',
      spiral: 'Spiral Ruled',
      index: 'Index Card',
      torn: 'Torn Draft',
    },
    marginTags: {
      note: 'Note',
      idea: 'Idea',
      ask: 'Question',
      star: 'Key',
      todo: 'Todo',
    },
    licenseBadge: 'License',
    licenseDeedLink: 'Deed ↗',
    licenseNames: {
      'cc-by-4.0': 'CC BY 4.0 · Attribution',
      'cc-by-sa-4.0': 'CC BY-SA 4.0 · Attribution-ShareAlike',
      'cc-by-nc-4.0': 'CC BY-NC 4.0 · Attribution-NonCommercial',
      'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0 · Attribution-NonCommercial-ShareAlike',
      'cc-by-nd-4.0': 'CC BY-ND 4.0 · Attribution-NoDerivatives',
      'cc-by-nc-nd-4.0': 'CC BY-NC-ND 4.0 · Attribution-NonCommercial-NoDerivatives',
      'cc0-1.0': 'CC0 1.0 · Public Domain',
      'all-rights-reserved': 'All Rights Reserved',
      none: 'Hidden',
    },
    auth: {
      title: 'Sign in',
      close: 'Close',
      identifierLabel: 'Username or Email',
      identifierPlaceholder: '',
      passwordLabel: 'Password',
      passwordPlaceholder: '',
      showPassword: 'Show',
      hidePassword: 'Hide',
      submitting: 'Signing in…',
      submitBtn: 'Sign in',
      loginFailed: 'Invalid username or password',
      ssoFailed: 'SSO verification failed',
      blogSsoLink: 'Sign in with Blog SSO ↗',
    },
    studio: {
      brandSuffix: 'Studio',
      backHomeTitle: 'Back to site',
      navAriaLabel: 'Studio navigation',
      sidebarAriaLabel: 'Sidebar',
      mobileDrawerAriaLabel: 'Navigation drawer',
      mobileDrawerTitle: 'Studio',
      closeDrawerAria: 'Close',
      openNavAria: 'Open menu',
      navBtnShort: 'Menu',
      expandSidebarAria: 'Expand sidebar',
      collapseSidebarAria: 'Collapse sidebar',
      breadcrumbAria: 'Breadcrumb',
      localeGroupAria: 'Language',
      frontpageLink: 'Site ↗',
      verifyingGate: 'Checking access…',
      unauthTitle: 'Sign in required',
      unauthDesc: 'Author or admin permissions are required to access Studio.',
      unauthCta: 'Sign in',
      readerGateTitle: (displayName) => `@${displayName} has Reader access`,
      readerGateDesc: 'Author or admin permissions are required for Studio.',
      readerGateCta: 'Back to Site',
      sections: {
        overview: 'Overview',
        editor: 'Editor',
        catalog: 'Catalog',
        users: 'Users',
        settings: 'Settings',
      },
      workbenchHeading: 'Workspace',
      explorerHeading: 'Articles',
      addTrackShort: '+ New Track',
      filterTreeAria: 'Filter articles',
      filterTreePlaceholder: 'Filter articles…',
      addStepInChapterAria: (title) => `New article in ${title}`,
      addStepInChapterTitle: 'New article',
      draftChip: 'Draft',
      hasDraftTitle: 'Has draft',
      hasDriftTitle: 'Translation outdated',
      noTreeMatches: (q) => `No results for "${q}"`,
      pgConnected: 'PostgreSQL',
      localSeedMode: 'LocalSeed',
      localesUnit: (n) => `${n} languages`,
      languageLabel: 'Language',
      overviewTitle: 'Overview',
      startNewNoteCta: '+ New Article',
      kpiRegionAria: 'Summary metrics',
      kpiTracksLabel: 'Tracks',
      kpiTracksSub: (ch) => `${ch} chapters`,
      kpiStepsLabel: 'Articles',
      kpiStepsSub: (pub, drafts) => `${pub} published · ${drafts} drafts`,
      kpiCoverageLabel: 'Translation Coverage',
      kpiResidentsLabel: 'Users',
      kpiPendingLabel: 'Pending',
      kpiResidentsSub: (c) => `${c} creators`,
      kpiPendingSub: 'Drafts & missing translations',
      queueTitle: 'Pending Drafts & Translations',
      queueCount: (n) => `${n}`,
      queueAllSyncedTitle: 'All translations up to date',
      badgeDraft: 'Draft',
      badgeDrifted: (s, c) => `v${s} < v${c}`,
      badgeMissing: 'Missing',
      actionContinueDraft: 'Edit',
      actionSyncDrift: 'Sync',
      actionAddTranslation: 'Translate',
      viewAllInMatrix: (n) => `View all ${n} →`,
      trackHealthTitle: 'Translation Progress',
      manageMatrixLink: 'Catalog →',
      siteConfigCardTitle: 'Site Config',
      openSettingsLink: 'Settings →',
      configSiteName: 'Site Name',
      configDefaultLocale: 'Default Language',
      configEnabledLocales: 'Languages',
      configSsoStatus: 'Blog SSO',
      configDraftAutosave: 'Draft Auto-Save',
      statusEnabled: 'Enabled',
      statusDisabled: 'Disabled',
      autosaveStatusOn: (secs) => `Auto-save · ${secs}s`,
      autosaveStatusOff: 'Auto-save off',
      autosavingNow: 'Auto-saving…',
      autosavedServer: (time) => `Draft auto-saved at ${time}`,
      autosavedLocal: (time) => `Saved locally at ${time}`,
      autosaveFailed: 'Auto-save failed',
      draftRecoveryBanner: (time) => `Unsaved local draft found (${time})`,
      restoreDraftBtn: 'Restore',
      discardDraftBtn: 'Discard',
      configureAutosaveTitle: 'Configure auto-save policy in Site Settings',
      editorHeadingSr: 'Editor',
      stepTrackLabel: 'Track',
      stepChapterLabel: 'Chapter',
      stepSlugLabel: 'Article Slug',
      backToList: 'Back',
      newStepToggle: '+ New Article',
      createBtn: 'Create',
      newStepOptionPrefix: '[New]',
      editLocaleLabel: (rev) => `Language (v${rev})`,
      publishCheckbox: 'Published',
      bumpCanonicalCheckbox: (cur, next) => `Bump version (v${cur} → v${next})`,
      deleteStepBtn: 'Delete',
      openReaderLink: 'Preview ↗',
      savingBtn: 'Saving…',
      saveBtn: (loc) => `Save (${loc})`,
      titleInputLabel: 'Title',
      titleInputPlaceholder: '',
      stepNumLabel: 'Order',
      minutesLabel: 'Min',
      summaryInputLabel: 'Summary',
      summaryInputPlaceholder: '',
      licenseSelectLabel: 'License',
      licenseFollowSite: (code) => `Site default (${code})`,
      tagsInputLabel: 'Tags',
      snippetsHeading: 'Quick Insert',
      markdownLabel: 'Markdown Source',
      livePreviewBadge: (loc) => `Live Preview · ${loc}`,
      untitledPlaceholder: 'Untitled',
      previewEmptyTitle: 'No content',
      previewEmptyDesc: '',
      switchedNewStepBanner: (slug) => `Draft created: ${slug}`,
      missingTitleOrSlugBanner: 'Title and slug are required',
      savedBanner: (loc, rev, isDraft, time) =>
        `Saved ${loc} v${rev} (${isDraft ? 'Draft' : 'Published'}) · ${time}`,
      saveFailedBanner: (msg) => `Save failed: ${msg}`,
      loadStepFailedBanner: (msg) => `Load failed: ${msg}`,
      deletedBanner: (slug) => `Deleted ${slug}`,
      deleteFailedBanner: (msg) => `Delete failed: ${msg}`,
      trackCreatedBanner: (title) => `Created track "${title}"`,
      trackCreateFailedBanner: (msg) => `Create failed: ${msg}`,
      chapterCreatedBanner: (trackSlug) => `Added chapter to ${trackSlug}`,
      chapterCreateFailedBanner: (msg) => `Create failed: ${msg}`,
      catalogTitle: 'Tracks & Languages',
      catalogEmptyTitle: 'No tracks yet',
      catalogEmptyDesc: '',
      addStepHereBtn: '+ New Article',
      canonicalRevMeta: (rev) => `v${rev}`,
      addLocaleAction: '+',
      draftParen: 'Draft',
      createTrackTitle: 'New Track',
      trackSlugLabel: 'Slug',
      trackSlugPlaceholder: '',
      trackTitleLabel: 'Title',
      trackTitlePlaceholder: '',
      trackDescLabel: 'Description',
      trackDescPlaceholder: '',
      difficultyLabel: 'Difficulty',
      firstChapterSlugLabel: 'First Chapter Slug',
      firstChapterTitleLabel: 'First Chapter Title',
      createTrackSubmit: 'Create Track',
      createChapterTitle: 'New Chapter',
      parentTrackLabel: 'Track',
      chapterSlugLabel: 'Slug',
      chapterNumLabel: 'Number',
      chapterTitleLabel: 'Title',
      chapterTitlePlaceholder: '',
      createChapterSubmit: 'Add Chapter',
      usersTitle: 'Users & Roles',
      roleCountAdmin: (n) => `Admin ${n}`,
      roleCountAuthor: (n) => `Author ${n}`,
      roleCountReader: (n) => `Reader ${n}`,
      roleUpdatedFeedback: (u, r) => `Updated @${u} role to ${r}`,
      roleUpdateFailedFeedback: (msg) => `Update failed: ${msg}`,
      colIdentity: 'User',
      colAuthSource: 'Source',
      colRole: 'Role',
      colWpId: 'WP ID',
      changeRoleAria: (name) => `Change role for ${name}`,
      roleOptReader: 'reader',
      roleOptAuthor: 'author',
      roleOptAdmin: 'admin',
      usersEmptyTitle: 'No users yet',
      usersEmptyDesc: '',
      deleteDialogAria: 'Confirm deletion',
      deleteDialogTitle: (slug) => `Delete "${slug}"?`,
      deleteDialogDesc:
        'This permanently deletes all language editions and local Markdown files. This cannot be undone.',
      deleteCancelBtn: 'Cancel',
      deleteConfirmBtn: 'Delete',
      snippets: {
        steps: '+ Task',
        tip: '+ Tip',
        note: '+ Note',
        info: '+ Info',
        warn: '+ Warn',
        danger: '+ Danger',
        margin: '+ Margin',
        code: '+ Code',
        sketch: '+ Diagram',
      },
      visual: {
        modeAria: 'Editor mode',
        visualTab: 'Visual Editor',
        markdownTab: 'Markdown Source',
        addBlockLabel: 'Insert Block',
        insertBelow: 'Insert below',
        emptyTitle: 'No content blocks yet',
        moveUp: 'Move up',
        moveDown: 'Move down',
        duplicate: 'Duplicate',
        deleteBlock: 'Delete',
        collapse: 'Collapse',
        expand: 'Expand',
        blockCount: (n) => `${n} blocks`,
        types: {
          heading: 'Heading',
          paragraph: 'Paragraph',
          steps: 'Task',
          alert: 'Sticker',
          code_card: 'Code Card',
          list: 'List',
          quote: 'Quote',
          rough_diagram: 'Diagram',
          raw_markdown: 'Raw Markdown',
        },
        headingPlaceholder: 'Heading…',
        paragraphPlaceholder: 'Write content…',
        marginNoteLabel: 'Author Note',
        marginNotePlaceholder: 'Note…',
        stepsTitleLabel: 'Group Heading',
        stepsTitlePlaceholder: '',
        stepItemTitlePlaceholder: 'Task…',
        stepItemDetailPlaceholder: 'Details…',
        addStepItem: 'Add subtask',
        defaultCheckedTitle: 'Checked by default',
        alertKindLabel: 'Type',
        stickerStyleLabel: 'Style',
        stickerToneLabel: 'Color',
        stickerAutoOption: 'Auto',
        stickerBadgePlaceholder: 'Badge',
        alertTitlePlaceholder: 'Title…',
        alertBodyPlaceholder: 'Content…',
        alertDetailSummaryPlaceholder: 'Details title…',
        alertDetailBodyPlaceholder: 'Details content…',
        codeStyleLabel: 'Sheet',
        codeLangLabel: 'Language',
        codeFilePlaceholder: 'Filename',
        codeBodyPlaceholder: 'Code…',
        listOrdered: 'Numbered',
        listUnordered: 'Bulleted',
        listItemPlaceholder: 'List item…',
        addListItem: 'Add item',
        quotePlaceholder: 'Quote…',
        diagramCaptionPlaceholder: 'Caption…',
        diagramNodesHeading: 'Nodes',
        diagramEdgesHeading: 'Edges',
        diagramAddNode: '+ Node',
        diagramAddEdge: '+ Edge',
        diagramAutoLayout: 'Auto-layout',
        diagramNodeLabelPlaceholder: 'Label',
        diagramNodeSubPlaceholder: 'Sublabel',
        diagramEdgeLabelPlaceholder: 'Edge label',
        fmtBold: 'Bold',
        fmtItalic: 'Italic',
        fmtCode: 'Code',
        fmtLink: 'Link',
      },
      settings: {
        title: 'Site Settings',
        generalGroup: 'General',
        siteNameLabel: 'Site Name',
        brandBadgeLabel: 'Brand Badge',
        brandBadgePlaceholder: '',
        heroTitleLabel: 'Home Title',
        heroTaglineLabel: 'Home Tagline',
        heroTaglinePlaceholder: '',
        footerTextLabel: 'Footer Text',
        footerTextPlaceholder: '',
        defaultAuthorLabel: 'Default Author',
        defaultAuthorPlaceholder: '',
        defaultLicenseLabel: 'Default License',
        localeThemeGroup: 'Language & Appearance',
        defaultLocaleLabel: 'Default Language',
        enabledLocalesLabel: 'Enabled Languages',
        defaultThemeLabel: 'Default Theme',
        themeSystem: 'System',
        themeDark: 'Dark',
        themeLight: 'Light',
        featuresGroup: 'Features',
        enableMarginNotesLabel: 'Enable margin notes',
        enableLikesLabel: 'Enable likes',
        enableProgressLabel: 'Enable task progress tracking',
        enableDraftAutosaveLabel: 'Auto-save drafts',
        draftAutosaveIntervalLabel: 'Auto-save interval',
        autosaveIntervalOption: (secs) => `Every ${secs}s`,
        integrationGroup: 'External Site & SSO',
        blogOriginUrlLabel: 'External Site URL',
        blogNavLabelLabel: 'Navbar Link Label',
        blogNavLabelPlaceholder: '',
        ssoQueryParamLabel: 'SSO Query Param',
        ssoEnabledLabel: 'Enable cross-site SSO sign-in',
        resetBtn: 'Reset',
        savingBtn: 'Saving…',
        saveBtn: 'Save Settings',
        savedMsg: 'Settings saved',
        saveFailedMsg: (msg) => `Save failed: ${msg}`,
        minOneLocaleError: 'Enable at least one language',
        updateGroup: 'Version & Updates',
        currentVersionLabel: 'Current Version',
        latestVersionLabel: 'Latest Version',
        checkUpdateBtn: 'Check for Updates',
        checkingUpdateBtn: 'Checking…',
        upToDateBadge: 'Up to date',
        updateAvailableBadge: (ver) => `Update: ${ver}`,
        viewReleaseLink: 'View Release ↗',
        updateCheckFailed: 'Check failed',
      },
    },
  },
  'zh-TW': {
    brandName: 'IceHandnote',
    navHome: '首頁',
    navStudio: '後台',
    navPrimaryAria: '主導覽',
    navMenuAria: '選單',
    navLanguageAria: '語言',
    followSystemLocale: '跟隨系統',
    otherSeriesHeading: '其他系列',
    taskScopeLabel: '任務類型',
    taskScopeSection: '節任務',
    taskScopeParagraph: '段任務',
    sectionTaskToggleLabel: '設為節任務',
    sectionTaskCompleteBtn: '完成本節',
    sectionTaskCompletedBadge: '已完成本節',
    sectionTaskDoneShort: '已完成',
    loginPassportBtn: '登入',
    logoutBtn: '登出',
    searchPlaceholder: '搜尋筆記與文章…',
    searchTrigger: '搜尋',
    searchTitle: '搜尋文章',
    searchEmptyTitle: '無相符結果',
    searchEmptyBody: '',
    closeLabel: '關閉',
    themeDarkLabel: '深色',
    themeLightLabel: '淺色',
    heroPrimaryCta: '開始閱讀 →',
    heroSecondaryCta: '搜尋 (⌘K)',
    tracksHeading: '專題',
    tracksEmptyTitle: '尚無專題',
    tracksEmptyBody: '',
    loadErrorTitle: '載入失敗',
    loadErrorBody: '',
    retryBtn: '重試',
    openNotebook: '閱讀 →',
    chaptersUnit: '章',
    stepsUnit: '篇',
    formatTrackCounts: (chapters, steps) => `${chapters} 章 · ${steps} 篇`,
    minutesUnit: '分鐘',
    tocButton: '目錄',
    tocHeading: '本文目錄',
    chapterDrawerButton: '章節',
    chapterOutlineAria: '章節目錄',
    stepProgressLabel: '進度',
    fallbackShortBadge: '原文',
    fallbackShortTitle: '回退顯示原文',
    fallbackBannerTitle: '尚無此語言版本',
    fallbackBannerBody: (resolved) => `目前顯示 ${resolved} 原文版本。`,
    driftBannerTitle: '翻譯版本已落後',
    driftBannerBody: (synced, canonical) =>
      `原文已更新至 v${canonical}，目前譯文仍為 v${synced}。`,
    switchCanonicalCta: (canonical) => `查看原文 v${canonical}`,
    stepNotFoundTitle: '找不到此頁面',
    stepNotFoundBody: '',
    pageNotFoundTitle: '頁面不存在（404）',
    pageNotFoundBody: '',
    backHomeCta: '返回首頁',
    addStickyBtn: '+ 筆記',
    stickyPlaceholder: '輸入筆記…',
    saveStickyBtn: '儲存',
    cancelBtn: '取消',
    deleteStickyAria: '刪除筆記',
    stickyColorAria: (color) => `顏色：${color}`,
    jumpToSectionAria: (text) => `跳轉至 ${text}`,
    authorNoteBadge: '作者批註',
    myNoteBadge: '我的筆記',
    copyCode: '複製',
    copiedCode: '已複製',
    copyFailedCode: '複製失敗',
    prevStep: '← 上一篇',
    nextStepPrimary: '下一篇 →',
    finishTrackPrimary: '返回專題首頁 →',
    markCompleted: '標記已讀',
    completedBadge: '✓ 已讀',
    likeStep: '讚',
    stepsDefaultTitle: '實踐任務',
    stepsProgressLabel: (done, total) => `已完成 ${done} / ${total}`,
    stepsAllDoneBadge: '✓ 全部任務已完成',
    stepsResetBtn: '重設勾選',
    articleTasksLabel: '本文任務',
    difficultyLabels: {
      beginner: '入門',
      intermediate: '進階',
      advanced: '架構',
    },
    alertStamps: {
      tip: '小貼士',
      note: '筆記',
      info: '說明',
      idea: '靈感',
      question: '思考',
      check: '要點',
      bookmark: '索引',
      warning: '注意',
      danger: '警示',
    },
    stickerStyles: {
      tape: '膠帶貼',
      pin: '圖釘卡',
      torn: '手撕籤',
      clip: '迴紋針',
      stamp: '郵票章',
      looseleaf: '活頁紙',
      tag: '書籤牌',
    },
    stickerTones: {
      amber: '暖黃',
      mint: '薄荷',
      ice: '冰青',
      violet: '暮紫',
      coral: '珊瑚',
      kraft: '牛皮紙',
    },
    codeCardStyles: {
      washi: '膠帶方格',
      spiral: '線圈橫格',
      index: '索引卡',
      torn: '手撕草稿',
    },
    marginTags: {
      note: '筆記',
      idea: '靈感',
      ask: '疑問',
      star: '重點',
      todo: '待辦',
    },
    licenseBadge: '授權條款',
    licenseDeedLink: '查看條款 ↗',
    licenseNames: {
      'cc-by-4.0': 'CC BY 4.0 · 姓名標示',
      'cc-by-sa-4.0': 'CC BY-SA 4.0 · 姓名標示-相同方式分享',
      'cc-by-nc-4.0': 'CC BY-NC 4.0 · 姓名標示-非商業性',
      'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0 · 姓名標示-非商業性-相同方式分享',
      'cc-by-nd-4.0': 'CC BY-ND 4.0 · 姓名標示-禁止改作',
      'cc-by-nc-nd-4.0': 'CC BY-NC-ND 4.0 · 姓名標示-非商業性-禁止改作',
      'cc0-1.0': 'CC0 1.0 · 公眾領域',
      'all-rights-reserved': '保留所有權利',
      none: '不顯示',
    },
    auth: {
      title: '登入',
      close: '關閉',
      identifierLabel: '帳號或 Email',
      identifierPlaceholder: '',
      passwordLabel: '密碼',
      passwordPlaceholder: '',
      showPassword: '顯示',
      hidePassword: '隱藏',
      submitting: '登入中…',
      submitBtn: '登入',
      loginFailed: '帳號或密碼錯誤',
      ssoFailed: 'SSO 驗證失敗',
      blogSsoLink: '使用主站帳號登入 ↗',
    },
    studio: {
      brandSuffix: '後台',
      backHomeTitle: '返回前台',
      navAriaLabel: '後台導覽',
      sidebarAriaLabel: '側邊欄',
      mobileDrawerAriaLabel: '導覽抽屜',
      mobileDrawerTitle: '後台導覽',
      closeDrawerAria: '關閉',
      openNavAria: '開啟導覽',
      navBtnShort: '導覽',
      expandSidebarAria: '展開側邊欄',
      collapseSidebarAria: '收起側邊欄',
      breadcrumbAria: '目前位置',
      localeGroupAria: '介面語言',
      frontpageLink: '前台 ↗',
      verifyingGate: '正在驗證權限…',
      unauthTitle: '請先登入',
      unauthDesc: '需要作者或管理員權限才能存取後台。',
      unauthCta: '登入',
      readerGateTitle: (displayName) => `@${displayName} 目前為讀者權限`,
      readerGateDesc: '需要作者或管理員權限才能進入後台。',
      readerGateCta: '返回前台',
      sections: {
        overview: '概覽',
        editor: '編輯器',
        catalog: '內容目錄',
        users: '用戶權限',
        settings: '站點設定',
      },
      workbenchHeading: '工作台',
      explorerHeading: '目錄',
      addTrackShort: '+ 新建專題',
      filterTreeAria: '篩選文章',
      filterTreePlaceholder: '篩選文章…',
      addStepInChapterAria: (title) => `在 ${title} 中新建文章`,
      addStepInChapterTitle: '新建文章',
      draftChip: '草稿',
      hasDraftTitle: '包含草稿',
      hasDriftTitle: '翻譯待同步',
      noTreeMatches: (q) => `找不到包含「${q}」的內容`,
      pgConnected: 'PostgreSQL',
      localSeedMode: 'LocalSeed',
      localesUnit: (n) => `${n} 種語言`,
      languageLabel: '語言',
      overviewTitle: '概覽',
      startNewNoteCta: '+ 新建文章',
      kpiRegionAria: '統計數據',
      kpiTracksLabel: '專題',
      kpiTracksSub: (ch) => `${ch} 個章節`,
      kpiStepsLabel: '文章',
      kpiStepsSub: (pub, drafts) => `已發佈 ${pub} · 草稿 ${drafts}`,
      kpiCoverageLabel: '多語言覆蓋率',
      kpiResidentsLabel: '用戶',
      kpiPendingLabel: '待處理',
      kpiResidentsSub: (c) => `${c} 位創作者`,
      kpiPendingSub: '草稿與待翻譯',
      queueTitle: '待處理的草稿與翻譯',
      queueCount: (n) => `${n} 項`,
      queueAllSyncedTitle: '全部已同步',
      badgeDraft: '草稿',
      badgeDrifted: (s, c) => `v${s} < v${c}`,
      badgeMissing: '待翻譯',
      actionContinueDraft: '繼續編輯',
      actionSyncDrift: '更新翻譯',
      actionAddTranslation: '補充翻譯',
      viewAllInMatrix: (n) => `檢視全部 ${n} 項 →`,
      trackHealthTitle: '各專題翻譯進度',
      manageMatrixLink: '內容目錄 →',
      siteConfigCardTitle: '站點配置',
      openSettingsLink: '設定 →',
      configSiteName: '站點名稱',
      configDefaultLocale: '預設語言',
      configEnabledLocales: '已啟用語言',
      configSsoStatus: '主站 SSO',
      configDraftAutosave: '草稿自動儲存',
      statusEnabled: '已啟用',
      statusDisabled: '已停用',
      autosaveStatusOn: (secs) => `自動儲存 · 每 ${secs} 秒`,
      autosaveStatusOff: '自動儲存已關閉',
      autosavingNow: '正在自動儲存…',
      autosavedServer: (time) => `草稿已於 ${time} 自動儲存`,
      autosavedLocal: (time) => `已於 ${time} 暫存至本機`,
      autosaveFailed: '自動儲存失敗',
      draftRecoveryBanner: (time) => `發現未儲存的本機草稿（${time}）`,
      restoreDraftBtn: '還原草稿',
      discardDraftBtn: '捨棄',
      configureAutosaveTitle: '前往站點設定調整自動儲存策略',
      editorHeadingSr: '編輯器',
      stepTrackLabel: '專題',
      stepChapterLabel: '章節',
      stepSlugLabel: '文章 Slug',
      backToList: '返回列表',
      newStepToggle: '+ 新建文章',
      createBtn: '建立',
      newStepOptionPrefix: '[新建]',
      editLocaleLabel: (rev) => `編輯語言（主版本 v${rev}）`,
      publishCheckbox: '公開發佈',
      bumpCanonicalCheckbox: (cur, next) => `升級主版本 (v${cur} → v${next})`,
      deleteStepBtn: '刪除',
      openReaderLink: '預覽 ↗',
      savingBtn: '儲存中…',
      saveBtn: (loc) => `儲存 (${loc})`,
      titleInputLabel: '標題',
      titleInputPlaceholder: '',
      stepNumLabel: '排序',
      minutesLabel: '分鐘',
      summaryInputLabel: '摘要',
      summaryInputPlaceholder: '',
      licenseSelectLabel: '授權條款',
      licenseFollowSite: (code) => `跟隨站點 (${code})`,
      tagsInputLabel: '標籤',
      snippetsHeading: '快捷插入',
      markdownLabel: 'Markdown 源碼',
      livePreviewBadge: (loc) => `即時預覽 · ${loc}`,
      untitledPlaceholder: '未命名',
      previewEmptyTitle: '尚無內容',
      previewEmptyDesc: '',
      switchedNewStepBanner: (slug) => `已切換至新建文章：${slug}`,
      missingTitleOrSlugBanner: '請填寫文章標題與 Slug',
      savedBanner: (loc, rev, isDraft, time) =>
        `已儲存 ${loc} v${rev}（${isDraft ? '草稿' : '已發佈'}）· ${time}`,
      saveFailedBanner: (msg) => `儲存失敗：${msg}`,
      loadStepFailedBanner: (msg) => `載入失敗：${msg}`,
      deletedBanner: (slug) => `已刪除 ${slug}`,
      deleteFailedBanner: (msg) => `刪除失敗：${msg}`,
      trackCreatedBanner: (title) => `已建立專題「${title}」`,
      trackCreateFailedBanner: (msg) => `建立失敗：${msg}`,
      chapterCreatedBanner: (trackSlug) => `已在 ${trackSlug} 中新增章節`,
      chapterCreateFailedBanner: (msg) => `新增失敗：${msg}`,
      catalogTitle: '專題與多語言目錄',
      catalogEmptyTitle: '尚無專題',
      catalogEmptyDesc: '',
      addStepHereBtn: '+ 新建文章',
      canonicalRevMeta: (rev) => `v${rev}`,
      addLocaleAction: '+',
      draftParen: '草稿',
      createTrackTitle: '新建專題',
      trackSlugLabel: 'Slug',
      trackSlugPlaceholder: '',
      trackTitleLabel: '名稱',
      trackTitlePlaceholder: '',
      trackDescLabel: '簡介',
      trackDescPlaceholder: '',
      difficultyLabel: '難度',
      firstChapterSlugLabel: '首章 Slug',
      firstChapterTitleLabel: '首章標題',
      createTrackSubmit: '建立專題',
      createChapterTitle: '新增章節',
      parentTrackLabel: '所屬專題',
      chapterSlugLabel: '章節 Slug',
      chapterNumLabel: '章號',
      chapterTitleLabel: '章節標題',
      chapterTitlePlaceholder: '',
      createChapterSubmit: '新增章節',
      usersTitle: '用戶與角色權限',
      roleCountAdmin: (n) => `管理員 ${n}`,
      roleCountAuthor: (n) => `作者 ${n}`,
      roleCountReader: (n) => `讀者 ${n}`,
      roleUpdatedFeedback: (u, r) => `已將 @${u} 的角色更新為 ${r}`,
      roleUpdateFailedFeedback: (msg) => `更新失敗：${msg}`,
      colIdentity: '用戶',
      colAuthSource: '登入來源',
      colRole: '角色',
      colWpId: 'WP ID',
      changeRoleAria: (name) => `調整 ${name} 的角色`,
      roleOptReader: 'reader',
      roleOptAuthor: 'author',
      roleOptAdmin: 'admin',
      usersEmptyTitle: '尚無用戶紀錄',
      usersEmptyDesc: '',
      deleteDialogAria: '確認刪除',
      deleteDialogTitle: (slug) => `確認刪除「${slug}」？`,
      deleteDialogDesc: '此操作將永久移除該文章的所有語言版本與本機檔案，且無法復原。',
      deleteCancelBtn: '取消',
      deleteConfirmBtn: '永久刪除',
      snippets: {
        steps: '+ 任務項',
        tip: '+ Tip',
        note: '+ Note',
        info: '+ Info',
        warn: '+ Warn',
        danger: '+ Danger',
        margin: '+ 批註',
        code: '+ 程式碼',
        sketch: '+ 流程圖',
      },
      visual: {
        modeAria: '編輯模式切換',
        visualTab: '視覺化編輯',
        markdownTab: 'Markdown 源碼',
        addBlockLabel: '插入內容塊',
        insertBelow: '在下方插入',
        emptyTitle: '尚未新增內容',
        moveUp: '上移',
        moveDown: '下移',
        duplicate: '複製',
        deleteBlock: '刪除',
        collapse: '折疊',
        expand: '展開',
        blockCount: (n) => `${n} 個區塊`,
        types: {
          heading: '章節標題',
          paragraph: '正文段落',
          steps: '任務項',
          alert: '貼紙卡片',
          code_card: '程式碼卡',
          list: '清單',
          quote: '引用',
          rough_diagram: '流程圖',
          raw_markdown: '原始 Markdown',
        },
        headingPlaceholder: '小節標題…',
        paragraphPlaceholder: '輸入正文…',
        marginNoteLabel: '作者批註',
        marginNotePlaceholder: '批註…',
        stepsTitleLabel: '分組標題',
        stepsTitlePlaceholder: '',
        stepItemTitlePlaceholder: '任務內容…',
        stepItemDetailPlaceholder: '補充說明…',
        addStepItem: '新增子任務',
        defaultCheckedTitle: '預設勾選',
        alertKindLabel: '貼紙類型',
        stickerStyleLabel: '貼紙樣式',
        stickerToneLabel: '紙張配色',
        stickerAutoOption: '預設',
        stickerBadgePlaceholder: '角標',
        alertTitlePlaceholder: '標題…',
        alertBodyPlaceholder: '內容…',
        alertDetailSummaryPlaceholder: '折疊標題…',
        alertDetailBodyPlaceholder: '折疊內容…',
        codeStyleLabel: '紙張樣式',
        codeLangLabel: '語言',
        codeFilePlaceholder: '檔案名稱',
        codeBodyPlaceholder: '程式碼…',
        listOrdered: '有序清單',
        listUnordered: '無序清單',
        listItemPlaceholder: '清單項目…',
        addListItem: '新增清單項目',
        quotePlaceholder: '引用內容…',
        diagramCaptionPlaceholder: '圖表說明…',
        diagramNodesHeading: '節點',
        diagramEdgesHeading: '連線',
        diagramAddNode: '+ 節點',
        diagramAddEdge: '+ 連線',
        diagramAutoLayout: '自動排佈',
        diagramNodeLabelPlaceholder: '節點名稱',
        diagramNodeSubPlaceholder: '副標題',
        diagramEdgeLabelPlaceholder: '連線標籤',
        fmtBold: '粗體',
        fmtItalic: '斜體',
        fmtCode: '代碼',
        fmtLink: '連結',
      },
      settings: {
        title: '站點設定',
        generalGroup: '基本資訊',
        siteNameLabel: '站點名稱',
        brandBadgeLabel: '品牌徽章',
        brandBadgePlaceholder: '',
        heroTitleLabel: '首頁標題',
        heroTaglineLabel: '首頁副標題',
        heroTaglinePlaceholder: '',
        footerTextLabel: '頁腳文案',
        footerTextPlaceholder: '',
        defaultAuthorLabel: '預設作者',
        defaultAuthorPlaceholder: '',
        defaultLicenseLabel: '預設授權條款',
        localeThemeGroup: '語言與外觀',
        defaultLocaleLabel: '預設語言',
        enabledLocalesLabel: '啟用語言',
        defaultThemeLabel: '預設主題',
        themeSystem: '跟隨系統',
        themeDark: '深色',
        themeLight: '淺色',
        featuresGroup: '功能設定',
        enableMarginNotesLabel: '啟用頁邊筆記',
        enableLikesLabel: '啟用文章點讚',
        enableProgressLabel: '啟用任務進度追蹤',
        enableDraftAutosaveLabel: '啟用草稿自動儲存',
        draftAutosaveIntervalLabel: '自動儲存間隔',
        autosaveIntervalOption: (secs) => `每 ${secs} 秒`,
        integrationGroup: '外部主站與 SSO',
        blogOriginUrlLabel: '外部主站網址',
        blogNavLabelLabel: '導覽連結名稱',
        blogNavLabelPlaceholder: '',
        ssoQueryParamLabel: 'SSO 參數名',
        ssoEnabledLabel: '啟用跨站 SSO 登入',
        resetBtn: '重設',
        savingBtn: '儲存中…',
        saveBtn: '儲存設定',
        savedMsg: '設定已儲存',
        saveFailedMsg: (msg) => `儲存失敗：${msg}`,
        minOneLocaleError: '請至少啟用一種語言',
        updateGroup: '版本與更新',
        currentVersionLabel: '目前版本',
        latestVersionLabel: '最新版本',
        checkUpdateBtn: '檢查更新',
        checkingUpdateBtn: '檢查中…',
        upToDateBadge: '已是最新',
        updateAvailableBadge: (ver) => `新版本 ${ver}`,
        viewReleaseLink: '查看發行版 ↗',
        updateCheckFailed: '檢查失敗',
      },
    },
  },
  ja: {
    brandName: 'IceHandnote',
    navHome: 'ホーム',
    navStudio: '管理',
    navPrimaryAria: 'メインナビゲーション',
    navMenuAria: 'メニュー',
    navLanguageAria: '言語',
    followSystemLocale: 'システムに従う',
    otherSeriesHeading: '他のシリーズ',
    taskScopeLabel: 'タスク種別',
    taskScopeSection: '節タスク',
    taskScopeParagraph: '段落タスク',
    sectionTaskToggleLabel: '節タスクにする',
    sectionTaskCompleteBtn: 'この節を完了',
    sectionTaskCompletedBadge: 'この節を完了済み',
    sectionTaskDoneShort: '完了',
    loginPassportBtn: 'ログイン',
    logoutBtn: 'ログアウト',
    searchPlaceholder: '記事・ノートを検索…',
    searchTrigger: '検索',
    searchTitle: '記事を検索',
    searchEmptyTitle: '一致する結果がありません',
    searchEmptyBody: '',
    closeLabel: '閉じる',
    themeDarkLabel: 'ダーク',
    themeLightLabel: 'ライト',
    heroPrimaryCta: '読み始める →',
    heroSecondaryCta: '検索 (⌘K)',
    tracksHeading: 'トラック',
    tracksEmptyTitle: 'トラックがありません',
    tracksEmptyBody: '',
    loadErrorTitle: '読み込みに失敗しました',
    loadErrorBody: '',
    retryBtn: '再試行',
    openNotebook: '読む →',
    chaptersUnit: '章',
    stepsUnit: '記事',
    formatTrackCounts: (chapters, steps) => `${chapters} 章 · ${steps} 記事`,
    minutesUnit: '分',
    tocButton: '目次',
    tocHeading: '目次',
    chapterDrawerButton: '章一覧',
    chapterOutlineAria: '章リスト',
    stepProgressLabel: '進捗',
    fallbackShortBadge: '原文',
    fallbackShortTitle: '原文を表示中',
    fallbackBannerTitle: '日本語版はまだありません',
    fallbackBannerBody: (resolved) => `${resolved} 原文を表示しています。`,
    driftBannerTitle: '翻訳が最新ではありません',
    driftBannerBody: (synced, canonical) =>
      `原文 v${canonical} に対し、現在の翻訳は v${synced} です。`,
    switchCanonicalCta: (canonical) => `原文 v${canonical} を表示`,
    stepNotFoundTitle: '記事が見つかりません',
    stepNotFoundBody: '',
    pageNotFoundTitle: 'ページが見つかりません (404)',
    pageNotFoundBody: '',
    backHomeCta: 'ホームへ戻る',
    addStickyBtn: '+ メモ',
    stickyPlaceholder: 'メモを入力…',
    saveStickyBtn: '保存',
    cancelBtn: 'キャンセル',
    deleteStickyAria: 'メモを削除',
    stickyColorAria: (color) => `色：${color}`,
    jumpToSectionAria: (text) => `${text} へ移動`,
    authorNoteBadge: '著者メモ',
    myNoteBadge: 'マイメモ',
    copyCode: 'コピー',
    copiedCode: 'コピー済み',
    copyFailedCode: '失敗',
    prevStep: '← 前の記事',
    nextStepPrimary: '次の記事 →',
    finishTrackPrimary: 'トラック一覧へ →',
    markCompleted: '既読にする',
    completedBadge: '✓ 既読',
    likeStep: 'いいね',
    stepsDefaultTitle: '実践タスク',
    stepsProgressLabel: (done, total) => `${done} / ${total} 完了`,
    stepsAllDoneBadge: '✓ 全タスク完了',
    stepsResetBtn: 'リセット',
    articleTasksLabel: '記事タスク',
    difficultyLabels: {
      beginner: '入門',
      intermediate: '実践',
      advanced: '設計',
    },
    alertStamps: {
      tip: 'ヒント',
      note: 'ノート',
      info: '補足',
      idea: '着想',
      question: '疑問',
      check: '要点',
      bookmark: '索引',
      warning: '注意',
      danger: '警告',
    },
    stickerStyles: {
      tape: 'マステ',
      pin: 'ピン留め',
      torn: 'ちぎり紙',
      clip: 'クリップ',
      stamp: '消印スタンプ',
      looseleaf: 'ルーズリーフ',
      tag: 'しおり札',
    },
    stickerTones: {
      amber: 'アンバー',
      mint: 'ミント',
      ice: 'アイス',
      violet: 'バイオレット',
      coral: 'コーラル',
      kraft: 'クラフト',
    },
    codeCardStyles: {
      washi: 'マステ方眼',
      spiral: 'リング横罫',
      index: '情報カード',
      torn: 'ラフメモ',
    },
    marginTags: {
      note: 'メモ',
      idea: '着想',
      ask: '疑問',
      star: '重要',
      todo: 'TODO',
    },
    licenseBadge: 'ライセンス',
    licenseDeedLink: '規約を見る ↗',
    licenseNames: {
      'cc-by-4.0': 'CC BY 4.0 · 表示',
      'cc-by-sa-4.0': 'CC BY-SA 4.0 · 表示-継承',
      'cc-by-nc-4.0': 'CC BY-NC 4.0 · 表示-非営利',
      'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0 · 表示-非営利-継承',
      'cc-by-nd-4.0': 'CC BY-ND 4.0 · 表示-改変禁止',
      'cc-by-nc-nd-4.0': 'CC BY-NC-ND 4.0 · 表示-非営利-改変禁止',
      'cc0-1.0': 'CC0 1.0 · パブリックドメイン',
      'all-rights-reserved': '無断転載禁止',
      none: '非表示',
    },
    auth: {
      title: 'ログイン',
      close: '閉じる',
      identifierLabel: 'ユーザー名またはメール',
      identifierPlaceholder: '',
      passwordLabel: 'パスワード',
      passwordPlaceholder: '',
      showPassword: '表示',
      hidePassword: '非表示',
      submitting: 'ログイン中…',
      submitBtn: 'ログイン',
      loginFailed: 'ログインに失敗しました',
      ssoFailed: 'SSO 検証に失敗しました',
      blogSsoLink: 'ブログアカウントでログイン ↗',
    },
    studio: {
      brandSuffix: '管理',
      backHomeTitle: '公開サイトへ',
      navAriaLabel: '管理メニュー',
      sidebarAriaLabel: 'サイドバー',
      mobileDrawerAriaLabel: 'ナビゲーションドロワー',
      mobileDrawerTitle: '管理メニュー',
      closeDrawerAria: '閉じる',
      openNavAria: 'メニューを開く',
      navBtnShort: 'メニュー',
      expandSidebarAria: 'サイドバーを展開',
      collapseSidebarAria: 'サイドバーを折りたたむ',
      breadcrumbAria: '現在位置',
      localeGroupAria: '言語',
      frontpageLink: 'サイト ↗',
      verifyingGate: '権限確認中…',
      unauthTitle: 'ログインが必要です',
      unauthDesc: '管理画面には執筆者または管理者権限が必要です。',
      unauthCta: 'ログイン',
      readerGateTitle: (displayName) => `@${displayName} は Reader 権限です`,
      readerGateDesc: '管理画面には Author 以上の権限が必要です。',
      readerGateCta: 'サイトへ戻る',
      sections: {
        overview: '概要',
        editor: 'エディタ',
        catalog: 'コンテンツ一覧',
        users: 'ユーザー',
        settings: 'サイト設定',
      },
      workbenchHeading: 'ワークスペース',
      explorerHeading: '記事一覧',
      addTrackShort: '+ 新規トラック',
      filterTreeAria: '記事を絞り込む',
      filterTreePlaceholder: '記事を絞り込む…',
      addStepInChapterAria: (title) => `${title} に記事を追加`,
      addStepInChapterTitle: '記事を追加',
      draftChip: '下書',
      hasDraftTitle: '下書きあり',
      hasDriftTitle: '翻訳差分あり',
      noTreeMatches: (q) => `「${q}」に一致する項目がありません`,
      pgConnected: 'PostgreSQL',
      localSeedMode: 'LocalSeed',
      localesUnit: (n) => `${n} 言語`,
      languageLabel: '言語',
      overviewTitle: '概要',
      startNewNoteCta: '+ 新規記事',
      kpiRegionAria: 'サマリー指標',
      kpiTracksLabel: 'トラック',
      kpiTracksSub: (ch) => `${ch} 章`,
      kpiStepsLabel: '記事',
      kpiStepsSub: (pub, drafts) => `公開 ${pub} · 下書 ${drafts}`,
      kpiCoverageLabel: '多言語カバー率',
      kpiResidentsLabel: 'ユーザー',
      kpiPendingLabel: '未同期',
      kpiResidentsSub: (c) => `執筆者 ${c}`,
      kpiPendingSub: '下書き・未翻訳',
      queueTitle: '下書きと未同期の翻訳',
      queueCount: (n) => `${n} 件`,
      queueAllSyncedTitle: 'すべて同期済み',
      badgeDraft: '下書',
      badgeDrifted: (s, c) => `v${s} < v${c}`,
      badgeMissing: '未訳',
      actionContinueDraft: '編集',
      actionSyncDrift: '同期',
      actionAddTranslation: '翻訳を追加',
      viewAllInMatrix: (n) => `全 ${n} 件を見る →`,
      trackHealthTitle: 'トラック別翻訳率',
      manageMatrixLink: 'コンテンツ一覧 →',
      siteConfigCardTitle: 'サイト構成',
      openSettingsLink: '設定 →',
      configSiteName: 'サイト名',
      configDefaultLocale: '既定言語',
      configEnabledLocales: '有効言語',
      configSsoStatus: 'SSO',
      configDraftAutosave: '下書き自動保存',
      statusEnabled: '有効',
      statusDisabled: '無効',
      autosaveStatusOn: (secs) => `自動保存 · ${secs}秒`,
      autosaveStatusOff: '自動保存オフ',
      autosavingNow: '自動保存中…',
      autosavedServer: (time) => `${time} に自動保存しました`,
      autosavedLocal: (time) => `${time} にローカル保存しました`,
      autosaveFailed: '自動保存に失敗しました',
      draftRecoveryBanner: (time) => `未保存のローカル下書きがあります（${time}）`,
      restoreDraftBtn: '復元',
      discardDraftBtn: '破棄',
      configureAutosaveTitle: 'サイト設定で自動保存ポリシーを変更',
      editorHeadingSr: 'エディタ',
      stepTrackLabel: 'トラック',
      stepChapterLabel: '章',
      stepSlugLabel: 'Slug',
      backToList: '戻る',
      newStepToggle: '+ 新規記事',
      createBtn: '作成',
      newStepOptionPrefix: '[新規]',
      editLocaleLabel: (rev) => `言語 (v${rev})`,
      publishCheckbox: '公開',
      bumpCanonicalCheckbox: (cur, next) => `バージョン更新 (v${cur} → v${next})`,
      deleteStepBtn: '削除',
      openReaderLink: '表示 ↗',
      savingBtn: '保存中…',
      saveBtn: (loc) => `保存 (${loc})`,
      titleInputLabel: 'タイトル',
      titleInputPlaceholder: '',
      stepNumLabel: '順序',
      minutesLabel: '分',
      summaryInputLabel: '概要',
      summaryInputPlaceholder: '',
      licenseSelectLabel: 'ライセンス',
      licenseFollowSite: (code) => `サイト既定 (${code})`,
      tagsInputLabel: 'タグ',
      snippetsHeading: 'クイック挿入',
      markdownLabel: 'Markdown ソース',
      livePreviewBadge: (loc) => `プレビュー · ${loc}`,
      untitledPlaceholder: '無題',
      previewEmptyTitle: 'コンテンツがありません',
      previewEmptyDesc: '',
      switchedNewStepBanner: (slug) => `新規作成：${slug}`,
      missingTitleOrSlugBanner: 'タイトルと Slug を入力してください',
      savedBanner: (loc, rev, isDraft, time) =>
        `${loc} v${rev} を保存（${isDraft ? '下書' : '公開'}）· ${time}`,
      saveFailedBanner: (msg) => `保存失敗：${msg}`,
      loadStepFailedBanner: (msg) => `読込失敗：${msg}`,
      deletedBanner: (slug) => `${slug} を削除しました`,
      deleteFailedBanner: (msg) => `削除失敗：${msg}`,
      trackCreatedBanner: (title) => `「${title}」を作成しました`,
      trackCreateFailedBanner: (msg) => `作成失敗：${msg}`,
      chapterCreatedBanner: (trackSlug) => `${trackSlug} に章を追加しました`,
      chapterCreateFailedBanner: (msg) => `追加失敗：${msg}`,
      catalogTitle: 'トラック＆多言語一覧',
      catalogEmptyTitle: 'トラックがありません',
      catalogEmptyDesc: '',
      addStepHereBtn: '+ 新規記事',
      canonicalRevMeta: (rev) => `v${rev}`,
      addLocaleAction: '+',
      draftParen: '下書',
      createTrackTitle: '新規トラック',
      trackSlugLabel: 'Slug',
      trackSlugPlaceholder: '',
      trackTitleLabel: '名前',
      trackTitlePlaceholder: '',
      trackDescLabel: '説明',
      trackDescPlaceholder: '',
      difficultyLabel: '難易度',
      firstChapterSlugLabel: '第1章 Slug',
      firstChapterTitleLabel: '第1章 タイトル',
      createTrackSubmit: '作成',
      createChapterTitle: '新規章',
      parentTrackLabel: 'トラック',
      chapterSlugLabel: 'Slug',
      chapterNumLabel: '章番号',
      chapterTitleLabel: 'タイトル',
      chapterTitlePlaceholder: '',
      createChapterSubmit: '追加',
      usersTitle: 'ユーザーと権限',
      roleCountAdmin: (n) => `管理者 ${n}`,
      roleCountAuthor: (n) => `執筆者 ${n}`,
      roleCountReader: (n) => `読者 ${n}`,
      roleUpdatedFeedback: (u, r) => `@${u} のロールを ${r} に変更しました`,
      roleUpdateFailedFeedback: (msg) => `更新失敗：${msg}`,
      colIdentity: 'ユーザー',
      colAuthSource: '認証元',
      colRole: 'ロール',
      colWpId: 'WP ID',
      changeRoleAria: (name) => `${name} のロール`,
      roleOptReader: 'reader',
      roleOptAuthor: 'author',
      roleOptAdmin: 'admin',
      usersEmptyTitle: 'ユーザーがありません',
      usersEmptyDesc: '',
      deleteDialogAria: '削除確認',
      deleteDialogTitle: (slug) => `「${slug}」を削除しますか？`,
      deleteDialogDesc: 'すべての言語版とローカルファイルが削除され、元に戻せません。',
      deleteCancelBtn: 'キャンセル',
      deleteConfirmBtn: '削除',
      snippets: {
        steps: '+ タスク',
        tip: '+ Tip',
        note: '+ Note',
        info: '+ Info',
        warn: '+ Warn',
        danger: '+ Danger',
        margin: '+ メモ',
        code: '+ コード',
        sketch: '+ 図解',
      },
      visual: {
        modeAria: '編集モード切替',
        visualTab: 'ビジュアル編集',
        markdownTab: 'Markdown ソース',
        addBlockLabel: 'ブロックを挿入',
        insertBelow: '下に挿入',
        emptyTitle: 'コンテンツブロックがありません',
        moveUp: '上へ',
        moveDown: '下へ',
        duplicate: '複製',
        deleteBlock: '削除',
        collapse: '折りたたむ',
        expand: '展開',
        blockCount: (n) => `${n} ブロック`,
        types: {
          heading: '見出し',
          paragraph: '段落',
          steps: 'タスク',
          alert: 'ステッカー',
          code_card: 'コードカード',
          list: 'リスト',
          quote: '引用',
          rough_diagram: '図解',
          raw_markdown: '生 Markdown',
        },
        headingPlaceholder: '見出し…',
        paragraphPlaceholder: '本文…',
        marginNoteLabel: '著者メモ',
        marginNotePlaceholder: 'メモ…',
        stepsTitleLabel: 'グループ見出し',
        stepsTitlePlaceholder: '',
        stepItemTitlePlaceholder: 'タスク…',
        stepItemDetailPlaceholder: '補足…',
        addStepItem: 'サブタスクを追加',
        defaultCheckedTitle: '初期チェック',
        alertKindLabel: '種類',
        stickerStyleLabel: 'スタイル',
        stickerToneLabel: '配色',
        stickerAutoOption: '標準',
        stickerBadgePlaceholder: 'バッジ',
        alertTitlePlaceholder: '見出し…',
        alertBodyPlaceholder: '本文…',
        alertDetailSummaryPlaceholder: '詳細見出し…',
        alertDetailBodyPlaceholder: '詳細…',
        codeStyleLabel: '用紙',
        codeLangLabel: '言語',
        codeFilePlaceholder: 'ファイル名',
        codeBodyPlaceholder: 'コード…',
        listOrdered: '番号付き',
        listUnordered: '箇条書き',
        listItemPlaceholder: 'リスト項目…',
        addListItem: '項目を追加',
        quotePlaceholder: '引用…',
        diagramCaptionPlaceholder: 'キャプション…',
        diagramNodesHeading: 'ノード',
        diagramEdgesHeading: '接続',
        diagramAddNode: '+ ノード',
        diagramAddEdge: '+ 接続',
        diagramAutoLayout: '自動整列',
        diagramNodeLabelPlaceholder: 'ラベル',
        diagramNodeSubPlaceholder: 'サブラベル',
        diagramEdgeLabelPlaceholder: '矢印ラベル',
        fmtBold: '太字',
        fmtItalic: '斜体',
        fmtCode: 'コード',
        fmtLink: 'リンク',
      },
      settings: {
        title: 'サイト設定',
        generalGroup: '基本情報',
        siteNameLabel: 'サイト名',
        brandBadgeLabel: 'バッジ',
        brandBadgePlaceholder: '',
        heroTitleLabel: 'トップ見出し',
        heroTaglineLabel: 'キャッチコピー',
        heroTaglinePlaceholder: '',
        footerTextLabel: 'フッター',
        footerTextPlaceholder: '',
        defaultAuthorLabel: '既定の著者',
        defaultAuthorPlaceholder: '',
        defaultLicenseLabel: '既定ライセンス',
        localeThemeGroup: '言語・外観',
        defaultLocaleLabel: '既定言語',
        enabledLocalesLabel: '有効言語',
        defaultThemeLabel: '既定テーマ',
        themeSystem: 'システム',
        themeDark: 'ダーク',
        themeLight: 'ライト',
        featuresGroup: '機能設定',
        enableMarginNotesLabel: '欄外メモを有効化',
        enableLikesLabel: 'いいねを有効化',
        enableProgressLabel: 'タスク進捗追跡を有効化',
        enableDraftAutosaveLabel: '下書きを自動保存',
        draftAutosaveIntervalLabel: '自動保存の間隔',
        autosaveIntervalOption: (secs) => `${secs} 秒ごと`,
        integrationGroup: '外部サイト・SSO 連携',
        blogOriginUrlLabel: '外部サイト URL',
        blogNavLabelLabel: 'ナビリンク名',
        blogNavLabelPlaceholder: '',
        ssoQueryParamLabel: 'SSO パラメータ名',
        ssoEnabledLabel: 'SSO ログインを有効化',
        resetBtn: 'リセット',
        savingBtn: '保存中…',
        saveBtn: '設定を保存',
        savedMsg: '設定を保存しました',
        saveFailedMsg: (msg) => `保存失敗：${msg}`,
        minOneLocaleError: '最低1つの言語を有効にしてください',
        updateGroup: 'バージョンと更新',
        currentVersionLabel: '現在のバージョン',
        latestVersionLabel: '最新バージョン',
        checkUpdateBtn: '更新を確認',
        checkingUpdateBtn: '確認中…',
        upToDateBadge: '最新です',
        updateAvailableBadge: (ver) => `新バージョン ${ver}`,
        viewReleaseLink: 'リリースを見る ↗',
        updateCheckFailed: '確認失敗',
      },
    },
  },
};
