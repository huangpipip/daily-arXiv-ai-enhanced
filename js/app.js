let currentDate = '';
let availableDates = [];
let currentView = 'grid'; // 'grid' 或 'list'
let currentCategory = 'all';
let paperData = {};
let flatpickrInstance = null;
let isRangeMode = false;
let activeKeywords = []; // 存储激活的关键词
let userKeywords = []; // 存储用户的关键词
let activeAuthors = []; // 存储激活的作者
let userAuthors = []; // 存储用户的作者
let currentPaperIndex = 0; // 当前查看的论文索引
let currentFilteredPapers = []; // 当前过滤后的论文列表
let textSearchQuery = ''; // 实时文本搜索查询
let previousActiveKeywords = null; // 文本搜索激活时，暂存之前的关键词激活集合
let previousActiveAuthors = null; // 文本搜索激活时，暂存之前的作者激活集合
const INDEX_DATA_SOURCES = [
  {
    name: 'arXiv',
    type: 'arxiv',
    showname: 'arXiv (cquctcmp.com)',
    repoOwner: DATA_CONFIG.repoOwner,
    repoName: DATA_CONFIG.repoName,
    dataBranch: DATA_CONFIG.dataBranch
  },
  {
    name: 'APS',
    type: 'aps',
    showname: 'APS (cquctcmp.com)',
    repoOwner: 'huangpipip',
    repoName: 'aps_rss_ai_everyday',
    dataBranch: 'main'
  },
  {
    name: 'arXiv4',
    type: 'arxiv',
    showname: 'arXiv (topomat12138)',
    repoOwner: 'topomat12138',
    repoName: 'daily-arXiv-ai-enhanced',
    dataBranch: 'data'
  },
  {
    name: 'arXiv2',
    type: 'arxiv',
    showname: 'arXiv (nishuobianchenghennan)',
    repoOwner: 'nishuobianchenghennan',
    repoName: 'daily-arXiv-ai-enhanced',
    dataBranch: 'main'
  },
  {
    name: 'arXiv3',
    type: 'arxiv',
    showname: 'arXiv (yp51md)',
    repoOwner: 'yp51md',
    repoName: 'daily-arXiv-ai-enhanced',
    dataBranch: 'main'
  }
];
let currentDataSource = INDEX_DATA_SOURCES[0];
let activeDataRequestId = 0;
const PAPER_MODAL_RESIZE_CONSTRAINTS = {
  minWidth: 680,
  minHeight: 420,
  viewportHorizontalMargin: 0,
  viewportVerticalMargin: 0
};
const paperModalResizeState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
  modal: null,
  content: null,
  handle: null
};

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function nextDataRequestId() {
  activeDataRequestId += 1;
  return activeDataRequestId;
}

function isActiveDataRequest(requestId) {
  return requestId === activeDataRequestId;
}

function getDataSourceByName(sourceName) {
  return INDEX_DATA_SOURCES.find(source => source.name === sourceName) || INDEX_DATA_SOURCES[0];
}

function getCurrentDataSourceLabel() {
  return currentDataSource?.showname || currentDataSource?.name || INDEX_DATA_SOURCES[0].showname || INDEX_DATA_SOURCES[0].name;
}

function getDataBaseUrl(dataSource = currentDataSource) {
  return `https://raw.githubusercontent.com/${dataSource.repoOwner}/${dataSource.repoName}/${dataSource.dataBranch}`;
}

function getDataUrl(filePath, dataSource = currentDataSource) {
  return `${getDataBaseUrl(dataSource)}/${filePath}`;
}

function getGitHubDataApiUrl(dataSource = currentDataSource) {
  return `https://api.github.com/repos/${dataSource.repoOwner}/${dataSource.repoName}/contents/data?ref=${dataSource.dataBranch}`;
}

function getPaperPrimaryUrl(paper) {
  return paper.abs_url || paper.html_url || paper.url || paper.pdf_url || '';
}

function isApsDataSource(dataSource = currentDataSource) {
  return dataSource?.type === 'aps';
}

function getApsPaperInfo(paper, dataSource = currentDataSource) {
  if (!isApsDataSource(dataSource)) {
    return null;
  }

  const primaryUrl = getPaperPrimaryUrl(paper);
  const categoryValue = Array.isArray(paper.category) ? paper.category[0] : paper.category;
  const journal = typeof categoryValue === 'string' ? categoryValue.trim().toLowerCase() : '';
  const doiFromId = typeof paper.id === 'string' && paper.id.startsWith('10.1103/') ? paper.id.trim() : '';

  let doiFromUrl = '';
  if (typeof primaryUrl === 'string' && primaryUrl) {
    try {
      const parsedUrl = new URL(primaryUrl);
      if (parsedUrl.hostname === 'link.aps.org') {
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'doi' && pathParts.length >= 3) {
          doiFromUrl = pathParts.slice(1).join('/');
        }
      } else if (parsedUrl.hostname === 'journals.aps.org') {
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 4) {
          doiFromUrl = pathParts.slice(2).join('/');
        }
      }
    } catch (error) {
      console.error('解析 APS 论文 URL 失败:', error);
    }
  }

  const doi = doiFromId || doiFromUrl;
  if (!journal || !doi) {
    return null;
  }

  return {
    journal,
    doi,
    abstractUrl: `https://journals.aps.org/${journal}/abstract/${doi}`,
    pdfUrl: `https://journals.aps.org/${journal}/pdf/${doi}`
  };
}

function getPaperDetailUrl(paper, dataSource = currentDataSource) {
  const apsInfo = getApsPaperInfo(paper, dataSource);
  if (apsInfo) {
    return apsInfo.abstractUrl;
  }

  const primaryUrl = getPaperPrimaryUrl(paper);
  if (typeof primaryUrl === 'string' && primaryUrl.includes('/pdf/')) {
    return primaryUrl.replace('/pdf/', '/abs/');
  }

  return primaryUrl;
}

function getPaperPdfUrl(paper, dataSource = currentDataSource) {
  const apsInfo = getApsPaperInfo(paper, dataSource);
  if (apsInfo) {
    return apsInfo.pdfUrl;
  }

  if (paper.pdf_url) {
    return paper.pdf_url;
  }

  const primaryUrl = getPaperPrimaryUrl(paper);
  if (typeof primaryUrl === 'string' && primaryUrl.includes('/abs/')) {
    return primaryUrl.replace('/abs/', '/pdf/');
  }

  return primaryUrl;
}

function getPaperHtmlUrl(paper, dataSource = currentDataSource) {
  const apsInfo = getApsPaperInfo(paper, dataSource);
  if (apsInfo) {
    return apsInfo.abstractUrl;
  }

  const primaryUrl = getPaperDetailUrl(paper, dataSource);
  if (typeof primaryUrl === 'string' && primaryUrl.includes('/pdf/')) {
    return primaryUrl.replace('/pdf/', '/html/');
  }

  return primaryUrl;
}

function renderDataSourceOptions() {
  const selector = document.getElementById('dataSourceSelect');
  if (!selector) {
    return;
  }

  selector.innerHTML = INDEX_DATA_SOURCES.map(source => (
    `<option value="${source.name}">${source.showname || source.name}</option>`
  )).join('');
  selector.value = currentDataSource?.name || INDEX_DATA_SOURCES[0].name;
}

function openNativeSelect(selectElement) {
  if (!selectElement || selectElement.disabled) {
    return;
  }

  selectElement.focus();

  if (typeof selectElement.showPicker === 'function') {
    try {
      selectElement.showPicker();
      return;
    } catch (error) {
      console.warn('打开数据源选择器失败，回退到 click():', error);
    }
  }

  selectElement.click();
}

function initDataSourceSelectorInteractions() {
  const selector = document.getElementById('dataSourceSelect');
  const selectorContainer = document.querySelector('.data-source-selector');
  if (!selector || !selectorContainer) {
    return;
  }

  selectorContainer.addEventListener('click', (event) => {
    const target = event.target;
    if (target === selector) {
      return;
    }

    if (target instanceof Element && target.closest('label')) {
      return;
    }

    openNativeSelect(selector);
  });
}

function resetDataStateForSourceChange() {
  const paperModal = document.getElementById('paperModal');
  if (paperModal?.classList.contains('active')) {
    closeModal();
  }

  currentDate = '';
  availableDates = [];
  paperData = {};
  currentCategory = 'all';
  currentFilteredPapers = [];
  currentPaperIndex = 0;
  window.dateLanguageMap = new Map();
  updatePaperNavigationControls();
}

function renderDataLoadingState(message = 'Loading papers...') {
  const dateLabel = document.getElementById('currentDate');
  const container = document.getElementById('paperContainer');
  if (dateLabel) {
    dateLabel.textContent = `${getCurrentDataSourceLabel()} · Loading...`;
  }
  if (container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>${message}</p>
      </div>
    `;
  }
  renderCategoryFilter({ sortedCategories: [], categoryCounts: {} });
}

function renderNoDataState(message) {
  const dateLabel = document.getElementById('currentDate');
  const container = document.getElementById('paperContainer');
  if (dateLabel) {
    dateLabel.textContent = `${getCurrentDataSourceLabel()} · No data`;
  }
  if (container) {
    container.innerHTML = `
      <div class="loading-container">
        <p>${message}</p>
      </div>
    `;
  }
  renderCategoryFilter({ sortedCategories: [], categoryCounts: {} });
}

async function reloadDataForCurrentSource() {
  const requestId = nextDataRequestId();
  resetDataStateForSourceChange();
  renderDataSourceOptions();
  renderDataLoadingState(`Loading ${getCurrentDataSourceLabel()} papers...`);

  const dates = await fetchAvailableDates(requestId, currentDataSource);
  if (!isActiveDataRequest(requestId)) {
    return;
  }

  if (dates.length === 0) {
    renderNoDataState(`No papers found for ${getCurrentDataSourceLabel()}.`);
    return;
  }

  await loadPapersByDate(dates[0], requestId, currentDataSource);
}

async function handleDataSourceChange(event) {
  const selectedSource = getDataSourceByName(event.target.value);
  if (selectedSource.name === currentDataSource?.name) {
    return;
  }

  currentDataSource = selectedSource;
  await reloadDataForCurrentSource();
}

function isPaperModalResizeEnabled() {
  return window.innerWidth > 768;
}

function getPaperModalResizeBounds() {
  const maxWidth = Math.max(360, window.innerWidth - PAPER_MODAL_RESIZE_CONSTRAINTS.viewportHorizontalMargin);
  const maxHeight = Math.max(320, window.innerHeight - PAPER_MODAL_RESIZE_CONSTRAINTS.viewportVerticalMargin);

  return {
    minWidth: Math.min(PAPER_MODAL_RESIZE_CONSTRAINTS.minWidth, maxWidth),
    minHeight: Math.min(PAPER_MODAL_RESIZE_CONSTRAINTS.minHeight, maxHeight),
    maxWidth,
    maxHeight
  };
}

function initPaperModalResize() {
  const modal = document.getElementById('paperModal');
  if (!modal) return;

  const content = modal.querySelector('.paper-modal-content');
  const handle = modal.querySelector('.paper-modal-resize-handle');
  if (!content || !handle) return;

  paperModalResizeState.modal = modal;
  paperModalResizeState.content = content;
  paperModalResizeState.handle = handle;

  handle.addEventListener('pointerdown', startPaperModalResize);
  window.addEventListener('pointermove', resizePaperModal);
  window.addEventListener('pointerup', stopPaperModalResize);
  window.addEventListener('pointercancel', stopPaperModalResize);
  window.addEventListener('resize', clampPaperModalSizeToViewport);
}

function initAutoCollapseHeader() {
  const header = document.querySelector('header');
  if (!header) return;

  const COLLAPSE_SCROLL_TOP = 120;
  const SCROLL_DELTA_THRESHOLD = 12;
  let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

  const setCollapsed = (collapsed) => {
    document.body.classList.toggle('header-collapsed', collapsed);
  };

  const handleScroll = () => {
    const scrollTop = Math.max(
      window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0,
      0
    );
    const delta = scrollTop - lastScrollTop;
    const paperModal = document.getElementById('paperModal');
    const datePickerModal = document.getElementById('datePickerModal');
    const shouldKeepExpanded =
      scrollTop < COLLAPSE_SCROLL_TOP ||
      (paperModal && paperModal.classList.contains('active')) ||
      (datePickerModal && datePickerModal.classList.contains('active'));

    if (shouldKeepExpanded) {
      setCollapsed(false);
      lastScrollTop = scrollTop;
      return;
    }

    if (Math.abs(delta) < SCROLL_DELTA_THRESHOLD) {
      return;
    }

    if (delta > 0) {
      setCollapsed(true);
    } else {
      setCollapsed(false);
    }

    lastScrollTop = scrollTop;
  };

  handleScroll();
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', () => {
    if ((window.pageYOffset || document.documentElement.scrollTop || 0) < COLLAPSE_SCROLL_TOP) {
      setCollapsed(false);
    }
  }, { passive: true });
}

function startPaperModalResize(event) {
  if (!isPaperModalResizeEnabled() || event.button !== 0) return;

  const { modal, content, handle } = paperModalResizeState;
  if (!modal || !content || !handle || !modal.classList.contains('active')) return;

  event.preventDefault();

  const rect = content.getBoundingClientRect();
  paperModalResizeState.active = true;
  paperModalResizeState.pointerId = event.pointerId;
  paperModalResizeState.startX = event.clientX;
  paperModalResizeState.startY = event.clientY;
  paperModalResizeState.startWidth = rect.width;
  paperModalResizeState.startHeight = rect.height;

  content.classList.add('is-resizing');
  document.body.classList.add('paper-modal-resizing');

  if (handle.setPointerCapture) {
    handle.setPointerCapture(event.pointerId);
  }
}

function resizePaperModal(event) {
  if (!paperModalResizeState.active || event.pointerId !== paperModalResizeState.pointerId) return;

  const { content } = paperModalResizeState;
  if (!content) return;

  event.preventDefault();

  const bounds = getPaperModalResizeBounds();
  const deltaX = event.clientX - paperModalResizeState.startX;
  const deltaY = event.clientY - paperModalResizeState.startY;
  const nextWidth = clampValue(
    paperModalResizeState.startWidth + deltaX * 2,
    bounds.minWidth,
    bounds.maxWidth
  );
  const nextHeight = clampValue(
    paperModalResizeState.startHeight + deltaY * 2,
    bounds.minHeight,
    bounds.maxHeight
  );

  content.style.width = `${nextWidth}px`;
  content.style.height = `${nextHeight}px`;
}

function stopPaperModalResize(event) {
  if (!paperModalResizeState.active) return;
  if (event && event.pointerId !== paperModalResizeState.pointerId) return;

  const { content, handle } = paperModalResizeState;
  const activePointerId = paperModalResizeState.pointerId;

  paperModalResizeState.active = false;
  paperModalResizeState.pointerId = null;

  if (content) {
    content.classList.remove('is-resizing');
  }
  document.body.classList.remove('paper-modal-resizing');

  if (handle && handle.hasPointerCapture && activePointerId !== null && handle.hasPointerCapture(activePointerId)) {
    handle.releasePointerCapture(activePointerId);
  }
}

function clampPaperModalSizeToViewport() {
  const { modal, content } = paperModalResizeState;
  if (!modal || !content) return;
  if (!content.style.width && !content.style.height) return;

  if (!isPaperModalResizeEnabled()) {
    resetPaperModalSize();
    return;
  }

  const rect = content.getBoundingClientRect();
  const bounds = getPaperModalResizeBounds();

  content.style.width = `${clampValue(rect.width, bounds.minWidth, bounds.maxWidth)}px`;
  content.style.height = `${clampValue(rect.height, bounds.minHeight, bounds.maxHeight)}px`;
}

function resetPaperModalSize() {
  const { content } = paperModalResizeState;

  stopPaperModalResize();
  document.body.classList.remove('paper-modal-resizing');

  if (!content) return;

  content.classList.remove('is-resizing');
  content.style.width = '';
  content.style.height = '';
}

// 加载用户的关键词设置
function loadUserKeywords() {
  const savedKeywords = localStorage.getItem('preferredKeywords');
  if (savedKeywords) {
    try {
      userKeywords = JSON.parse(savedKeywords);
      // 默认激活所有关键词
      activeKeywords = [...userKeywords];
    } catch (error) {
      console.error('解析关键词失败:', error);
      userKeywords = [];
      activeKeywords = [];
    }
  } else {
    userKeywords = [];
    activeKeywords = [];
  }
  
  // renderKeywordTags();
  renderFilterTags();
}

// 加载用户的作者设置
function loadUserAuthors() {
  const savedAuthors = localStorage.getItem('preferredAuthors');
  if (savedAuthors) {
    try {
      userAuthors = JSON.parse(savedAuthors);
      // 默认激活所有作者
      activeAuthors = [...userAuthors];
    } catch (error) {
      console.error('解析作者失败:', error);
      userAuthors = [];
      activeAuthors = [];
    }
  } else {
    userAuthors = [];
    activeAuthors = [];
  }
  
  renderFilterTags();
}

// 渲染过滤标签（作者和关键词）
function renderFilterTags() {
  const filterTagsElement = document.getElementById('filterTags');
  const filterContainer = document.querySelector('.filter-label-container');
  
  // 如果没有作者和关键词，仅隐藏标签区域，保留容器（以显示搜索按钮）
  if ((!userAuthors || userAuthors.length === 0) && (!userKeywords || userKeywords.length === 0)) {
    filterContainer.style.display = 'flex';
    if (filterTagsElement) {
      filterTagsElement.style.display = 'none';
      filterTagsElement.innerHTML = '';
    }
    return;
  }
  
  filterContainer.style.display = 'flex';
  if (filterTagsElement) {
    filterTagsElement.style.display = 'flex';
  }
  filterTagsElement.innerHTML = '';
  
  // 先添加作者标签
  if (userAuthors && userAuthors.length > 0) {
    userAuthors.forEach(author => {
      const tagElement = document.createElement('span');
      tagElement.className = `category-button author-button ${activeAuthors.includes(author) ? 'active' : ''}`;
      tagElement.textContent = author;
      tagElement.dataset.author = author;
      tagElement.title = "匹配作者姓名";
      
      tagElement.addEventListener('click', () => {
        toggleAuthorFilter(author);
      });
      
      filterTagsElement.appendChild(tagElement);
      
      // 添加出现动画后移除动画类
      if (!activeAuthors.includes(author)) {
        tagElement.classList.add('tag-appear');
        setTimeout(() => {
          tagElement.classList.remove('tag-appear');
        }, 300);
      }
    });
  }
  
  // 再添加关键词标签
  if (userKeywords && userKeywords.length > 0) {
    userKeywords.forEach(keyword => {
      const tagElement = document.createElement('span');
      tagElement.className = `category-button keyword-button ${activeKeywords.includes(keyword) ? 'active' : ''}`;
      tagElement.textContent = keyword;
      tagElement.dataset.keyword = keyword;
      tagElement.title = "匹配标题和摘要中的关键词";
      
      tagElement.addEventListener('click', () => {
        toggleKeywordFilter(keyword);
      });
      
      filterTagsElement.appendChild(tagElement);
      
      // 添加出现动画后移除动画类
      if (!activeKeywords.includes(keyword)) {
        tagElement.classList.add('tag-appear');
        setTimeout(() => {
          tagElement.classList.remove('tag-appear');
        }, 300);
      }
    });
  }
}

// 切换关键词过滤
function toggleKeywordFilter(keyword) {
  const index = activeKeywords.indexOf(keyword);
  
  if (index === -1) {
    // 激活该关键词
    activeKeywords.push(keyword);
  } else {
    // 取消激活该关键词
    activeKeywords.splice(index, 1);
  }
  
  // 更新关键词标签UI
  const keywordTags = document.querySelectorAll('[data-keyword]');
  keywordTags.forEach(tag => {
    if (tag.dataset.keyword === keyword) {
      // 先移除上一次可能的高亮动画
      tag.classList.remove('tag-highlight');
      
      // 添加/移除激活状态
      tag.classList.toggle('active', activeKeywords.includes(keyword));
      
      // 添加高亮动画
      setTimeout(() => {
        tag.classList.add('tag-highlight');
      }, 10);
      
      // 移除高亮动画
      setTimeout(() => {
        tag.classList.remove('tag-highlight');
      }, 1000);
    }
  });
  
  // 重新渲染论文列表
  renderPapers();
}


// 切换作者过滤
function toggleAuthorFilter(author) {
  const index = activeAuthors.indexOf(author);
  
  if (index === -1) {
    // 激活该作者
    activeAuthors.push(author);
  } else {
    // 取消激活该作者
    activeAuthors.splice(index, 1);
  }
  
  // 更新作者标签UI
  const authorTags = document.querySelectorAll('[data-author]');
  authorTags.forEach(tag => {
    if (tag.dataset.author === author) {
      // 先移除上一次可能的高亮动画
      tag.classList.remove('tag-highlight');
      
      // 添加/移除激活状态
      tag.classList.toggle('active', activeAuthors.includes(author));
      
      // 添加高亮动画
      setTimeout(() => {
        tag.classList.add('tag-highlight');
      }, 10);
      
      // 移除高亮动画
      setTimeout(() => {
        tag.classList.remove('tag-highlight');
      }, 1000);
    }
  });
  
  // 重新渲染论文列表
  renderPapers();
}

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  initDataSourceSelectorInteractions();
  renderDataSourceOptions();
  
  fetchGitHubStats();
  
  // 加载用户关键词
  loadUserKeywords();
  
  // 加载用户作者
  loadUserAuthors();
  
  reloadDataForCurrentSource();
});

async function fetchGitHubStats() {
  const starCountElement = document.getElementById('starCount');
  const forkCountElement = document.getElementById('forkCount');
  if (!starCountElement || !forkCountElement) {
    return;
  }

  try {
    const response = await fetch('https://api.github.com/repos/huangpipip/daily-arXiv-ai-enhanced');
    const data = await response.json();
    const starCount = data.stargazers_count;
    const forkCount = data.forks_count;
    
    starCountElement.textContent = starCount;
    forkCountElement.textContent = forkCount;
  } catch (error) {
    console.error('获取GitHub统计数据失败:', error);
    starCountElement.textContent = '?';
    forkCountElement.textContent = '?';
  }
}

function initEventListeners() {
  const dataSourceSelect = document.getElementById('dataSourceSelect');
  if (dataSourceSelect) {
    dataSourceSelect.addEventListener('change', handleDataSourceChange);
  }

  // 日期选择器相关的事件监听
  const calendarButton = document.getElementById('calendarButton');
  calendarButton.addEventListener('click', (e) => {
    e.stopPropagation();
    openDatePicker();
  });
  
  const datePickerModal = document.querySelector('.date-picker-modal');
  datePickerModal.addEventListener('click', (event) => {
    if (event.target === datePickerModal) {
      closeDatePicker();
    }
  });
  
  const datePickerContent = document.querySelector('.date-picker-content');
  datePickerContent.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.getElementById('dateRangeMode').addEventListener('change', toggleRangeMode);
  
  // 其他原有的事件监听器
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.querySelectorAll('[data-paper-nav="prev"]').forEach(button => {
    button.addEventListener('click', navigateToPreviousPaper);
  });
  document.querySelectorAll('[data-paper-nav="next"]').forEach(button => {
    button.addEventListener('click', navigateToNextPaper);
  });
  initPaperModalResize();
  initAutoCollapseHeader();
  updatePaperNavigationControls();
  
  document.querySelector('.paper-modal').addEventListener('click', (event) => {
    const modal = document.querySelector('.paper-modal');
    const pdfContainer = modal.querySelector('.pdf-container');
    
    // 如果点击的是模态框背景
    if (event.target === modal) {
      // 检查PDF是否处于放大状态
      if (pdfContainer && pdfContainer.classList.contains('expanded')) {
        // 如果PDF是放大的，先将其恢复正常大小
        const expandButton = modal.querySelector('.pdf-expand-btn');
        if (expandButton) {
          togglePdfSize(expandButton);
        }
        // 阻止事件继续传播，防止关闭整个模态框
        event.stopPropagation();
      } else {
        // 如果PDF不是放大状态，则关闭整个模态框
        closeModal();
      }
    }
  });
  
  // 添加键盘事件监听 - Esc 键关闭模态框，[ 和 ] 切换论文，R 键显示随机论文
  document.addEventListener('keydown', (event) => {
    // 检查是否有输入框或文本区域处于焦点状态
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
      activeElement.tagName === 'INPUT' || 
      activeElement.tagName === 'TEXTAREA' || 
      activeElement.isContentEditable
    );
    
    if (event.key === 'Escape') {
      const paperModal = document.getElementById('paperModal');
      const datePickerModal = document.getElementById('datePickerModal');
      
      // 关闭论文模态框
      if (paperModal.classList.contains('active')) {
        closeModal();
      }
      // 关闭日期选择器模态框
      else if (datePickerModal.classList.contains('active')) {
        closeDatePicker();
      }
    }
    // [ 和 ] 导航论文（仅在论文模态框打开时）
    else if (
      event.key === '[' ||
      event.key === ']' ||
      event.code === 'BracketLeft' ||
      event.code === 'BracketRight'
    ) {
      const paperModal = document.getElementById('paperModal');
      if (paperModal.classList.contains('active')) {
        event.preventDefault(); // 防止页面滚动
        
        if (event.key === '[' || event.code === 'BracketLeft') {
          navigateToPreviousPaper();
        } else if (event.key === ']' || event.code === 'BracketRight') {
          navigateToNextPaper();
        }
      }
    }
    // space 键显示随机论文（在没有输入框焦点且日期选择器未打开时）
    else if (event.key === ' ' || event.key === 'Spacebar') {
      const paperModal = document.getElementById('paperModal');
      const datePickerModal = document.getElementById('datePickerModal');
      
      // 只有在没有输入框焦点且日期选择器没有打开时才触发
      // 现在允许在论文模态框打开时也能使用R键切换到随机论文
      if (!isInputFocused && !datePickerModal.classList.contains('active')) {
        event.preventDefault(); // 防止页面刷新
        event.stopPropagation(); // 阻止事件冒泡
        showRandomPaper();
      }
    }
  });
  
  // 添加鼠标滚轮横向滚动支持
  const categoryScroll = document.querySelector('.category-scroll');
  const keywordScroll = document.querySelector('.keyword-scroll');
  const authorScroll = document.querySelector('.author-scroll');
  
  // 为类别滚动添加鼠标滚轮事件
  if (categoryScroll) {
    categoryScroll.addEventListener('wheel', function(e) {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.scrollLeft += e.deltaY;
      }
    });
  }
  
  // 为关键词滚动添加鼠标滚轮事件
  if (keywordScroll) {
    keywordScroll.addEventListener('wheel', function(e) {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.scrollLeft += e.deltaY;
      }
    });
  }
  
  // 为作者滚动添加鼠标滚轮事件
  if (authorScroll) {
    authorScroll.addEventListener('wheel', function(e) {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.scrollLeft += e.deltaY;
      }
    });
  }

  // 其他事件监听器...
  const categoryButtons = document.querySelectorAll('.category-button');
  categoryButtons.forEach(button => {
    button.addEventListener('click', () => {
      const category = button.dataset.category;
      filterByCategory(category);
    });
  });

  // 回到顶部按钮：滚动显示/隐藏 + 点击回到顶部
  const backToTopButton = document.getElementById('backToTop');
  if (backToTopButton) {
    const updateBackToTopVisibility = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (scrollTop > 300) {
        backToTopButton.classList.add('visible');
      } else {
        backToTopButton.classList.remove('visible');
      }
    };

    // 初始判断一次（防止刷新在中部时不显示）
    updateBackToTopVisibility();
    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });

    backToTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 文本搜索：搜索框始终显示，放大镜按钮仅用于聚焦输入框
  const searchToggle = document.getElementById('textSearchToggle');
  const searchWrapper = document.querySelector('#textSearchContainer .search-input-wrapper');
  const searchInput = document.getElementById('textSearchInput');
  const searchClear = document.getElementById('textSearchClear');

  if (searchToggle && searchWrapper && searchInput && searchClear) {
    searchToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.focus();
    });

    // 输入时更新查询并重新渲染
    const handleInput = () => {
      const value = searchInput.value.trim();
      textSearchQuery = value;
      // 有非空文本时：通过切换函数真正停用关键词/作者过滤，并记录之前状态
      if (textSearchQuery.length > 0) {
        if (previousActiveKeywords === null) {
          previousActiveKeywords = [...activeKeywords];
        }
        if (previousActiveAuthors === null) {
          previousActiveAuthors = [...activeAuthors];
        }
        // 逐个停用当前激活的关键词/作者
        // 注意：在遍历前复制数组，避免在切换过程中修改原数组导致遍历问题
        const keywordsToDisable = [...activeKeywords];
        const authorsToDisable = [...activeAuthors];
        keywordsToDisable.forEach(k => toggleKeywordFilter(k));
        authorsToDisable.forEach(a => toggleAuthorFilter(a));
      } else {
        // 文本删除为空，恢复之前记录的关键词/作者激活状态
        if (previousActiveKeywords && previousActiveKeywords.length > 0) {
          previousActiveKeywords.forEach(k => {
            // 若当前未激活则切换回激活
            if (!activeKeywords.includes(k)) toggleKeywordFilter(k);
          });
        }
        if (previousActiveAuthors && previousActiveAuthors.length > 0) {
          previousActiveAuthors.forEach(a => {
            if (!activeAuthors.includes(a)) toggleAuthorFilter(a);
          });
        }
        previousActiveKeywords = null;
        previousActiveAuthors = null;
      }

      // 控制清除按钮显示
      searchClear.style.display = textSearchQuery.length > 0 ? 'inline-flex' : 'none';

      renderPapers();
    };

    searchInput.addEventListener('input', handleInput);

    // 清除按钮：清空文本，恢复其他过滤
    searchClear.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = '';
      textSearchQuery = '';
      searchClear.style.display = 'none';
      // 恢复之前的过滤状态（如有）
      if (previousActiveKeywords && previousActiveKeywords.length > 0) {
        previousActiveKeywords.forEach(k => {
          if (!activeKeywords.includes(k)) toggleKeywordFilter(k);
        });
      }
      if (previousActiveAuthors && previousActiveAuthors.length > 0) {
        previousActiveAuthors.forEach(a => {
          if (!activeAuthors.includes(a)) toggleAuthorFilter(a);
        });
      }
      previousActiveKeywords = null;
      previousActiveAuthors = null;
      renderPapers();
      searchInput.focus();
    });
  }
}

// Function to detect preferred language based on browser settings
function getPreferredLanguage() {
  const browserLang = navigator.language || navigator.userLanguage;
  // Check if browser is set to Chinese variants
  if (browserLang.startsWith('zh')) {
    return 'Chinese';
  }
  // Default to Chinese for all other languages
  return 'Chinese';
}

// Function to select the best available language for a date
function selectLanguageForDate(date, preferredLanguage = null) {
  const availableLanguages = window.dateLanguageMap?.get(date) || [];
  
  if (availableLanguages.length === 0) {
    return 'Chinese'; // fallback
  }
  
  // Use provided preference or detect from browser
  const preferred = preferredLanguage || getPreferredLanguage();
  
  // If preferred language is available, use it
  if (availableLanguages.includes(preferred)) {
    return preferred;
  }
  
  // Fallback: prefer Chinese if available, otherwise use the first available
  return availableLanguages.includes('Chinese') ? 'Chinese' : availableLanguages[0];
}

function buildAvailableDateMetadata(files) {
  const dateRegex = /(\d{4}-\d{2}-\d{2})_AI_enhanced_(English|Chinese)\.jsonl/;
  const dateLanguageMap = new Map();
  const dates = [];

  files.forEach(file => {
    const fileName = typeof file === 'string' ? file.trim() : file?.name;
    if (!fileName) {
      return;
    }

    const match = fileName.match(dateRegex);
    if (match && match[1] && match[2]) {
      const date = match[1];
      const language = match[2];

      if (!dateLanguageMap.has(date)) {
        dateLanguageMap.set(date, []);
        dates.push(date);
      }
      dateLanguageMap.get(date).push(language);
    }
  });

  return {
    dateLanguageMap,
    availableDates: [...new Set(dates)].sort((a, b) => new Date(b) - new Date(a))
  };
}

function applyAvailableDateMetadata(metadata) {
  window.dateLanguageMap = metadata.dateLanguageMap;
  availableDates = metadata.availableDates;
  if (availableDates.length > 0) {
    initDatePicker();
  } else if (flatpickrInstance) {
    flatpickrInstance.destroy();
    flatpickrInstance = null;
  }
  return availableDates;
}

async function fetchAvailableDatesFromFileList(dataSource = currentDataSource) {
  const fileListUrl = getDataUrl('assets/file-list.txt', dataSource);
  const response = await fetch(fileListUrl);
  if (!response.ok) {
    throw new Error(`Error fetching file list: ${response.status}`);
  }

  const text = await response.text();
  const files = text.trim() ? text.trim().split('\n') : [];
  return buildAvailableDateMetadata(files);
}

async function fetchAvailableDatesFromGitHubApi(dataSource = currentDataSource) {
  const apiUrl = getGitHubDataApiUrl(dataSource);
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Error fetching GitHub data listing: ${response.status}`);
  }

  const files = await response.json();
  return buildAvailableDateMetadata(Array.isArray(files) ? files : []);
}

async function fetchAvailableDates(requestId = activeDataRequestId, dataSource = currentDataSource) {
  try {
    const fileListMetadata = await fetchAvailableDatesFromFileList(dataSource);
    if (!isActiveDataRequest(requestId)) {
      return [];
    }

    if (fileListMetadata.availableDates.length > 1) {
      return applyAvailableDateMetadata(fileListMetadata);
    }

    const apiMetadata = await fetchAvailableDatesFromGitHubApi(dataSource);
    if (!isActiveDataRequest(requestId)) {
      return [];
    }
    if (apiMetadata.availableDates.length > fileListMetadata.availableDates.length) {
      return applyAvailableDateMetadata(apiMetadata);
    }

    return applyAvailableDateMetadata(fileListMetadata);
  } catch (error) {
    console.error('获取可用日期失败，尝试 GitHub API 回退:', error);

    try {
      const apiMetadata = await fetchAvailableDatesFromGitHubApi(dataSource);
      if (!isActiveDataRequest(requestId)) {
        return [];
      }
      return applyAvailableDateMetadata(apiMetadata);
    } catch (apiError) {
      console.error('GitHub API 回退也失败:', apiError);
      return [];
    }
  }
}

function initDatePicker() {
  if (availableDates.length === 0) {
    return;
  }

  const datepickerInput = document.getElementById('datepicker');
  
  if (flatpickrInstance) {
    flatpickrInstance.destroy();
  }
  
  // 创建可用日期的映射，用于禁用无效日期
  const enabledDatesMap = {};
  availableDates.forEach(date => {
    enabledDatesMap[date] = true;
  });
  
  // 配置 Flatpickr
  flatpickrInstance = flatpickr(datepickerInput, {
    inline: true,
    dateFormat: "Y-m-d",
    mode: isRangeMode ? 'range' : 'single',
    defaultDate: availableDates[0],
    enable: [
      function(date) {
        // 只允许选择最新可用日期及之前的日期，范围内数据缺口在加载时再过滤
        const dateStr = date.getFullYear() + "-" +
                        String(date.getMonth() + 1).padStart(2, '0') + "-" +
                        String(date.getDate()).padStart(2, '0');
        return dateStr <= availableDates[0];
      }
    ],
    onChange: function(selectedDates, dateStr) {
      if (isRangeMode && selectedDates.length === 2) {
        // 处理日期范围选择
        const startDate = formatDateForAPI(selectedDates[0]);
        const endDate = formatDateForAPI(selectedDates[1]);
        const requestId = nextDataRequestId();
        loadPapersByDateRange(startDate, endDate, requestId, currentDataSource);
        closeDatePicker();
      } else if (!isRangeMode && selectedDates.length === 1) {
        // 处理单个日期选择
        const selectedDate = formatDateForAPI(selectedDates[0]);
        // if (availableDates.includes(selectedDate)) {
          const requestId = nextDataRequestId();
          loadPapersByDate(selectedDate, requestId, currentDataSource);
          closeDatePicker();
        // }
      }
    }
  });
  
  // 隐藏日期输入框
  const inputElement = document.querySelector('.flatpickr-input');
  if (inputElement) {
    inputElement.style.display = 'none';
  }
}

function parseCurrentDateRange(dateValue) {
  if (typeof dateValue !== 'string') {
    return null;
  }

  const rangeMatch = dateValue.match(/^(\d{4}-\d{2}-\d{2})\s(?:to|-)\s(\d{4}-\d{2}-\d{2})$/);
  if (!rangeMatch) {
    return null;
  }

  return [rangeMatch[1], rangeMatch[2]];
}

function getDatePickerSelection() {
  if (availableDates.length === 0) {
    return [];
  }

  if (isRangeMode) {
    const range = parseCurrentDateRange(currentDate);
    if (range) {
      return range;
    }
    return [];
  }

  const range = parseCurrentDateRange(currentDate);
  if (range) {
    return range[0];
  }

  return currentDate && availableDates.includes(currentDate) ? currentDate : availableDates[0];
}

function syncDatePickerSelection() {
  if (!flatpickrInstance) {
    return;
  }

  flatpickrInstance.setDate(getDatePickerSelection(), false);
}

function formatDateForAPI(date) {
  return date.getFullYear() + "-" + 
         String(date.getMonth() + 1).padStart(2, '0') + "-" + 
         String(date.getDate()).padStart(2, '0');
}

function toggleRangeMode() {
  isRangeMode = document.getElementById('dateRangeMode').checked;
  
  if (availableDates.length > 0) {
    initDatePicker();
    syncDatePickerSelection();
  }
}

async function loadPapersByDate(date, requestId = activeDataRequestId, dataSource = currentDataSource) {
  if (!isActiveDataRequest(requestId)) {
    return;
  }

  currentDate = date;
  document.getElementById('currentDate').textContent = `${dataSource.showname || dataSource.name} · ${formatDate(date)}`;
  
  // 更新日期选择器中的选中日期
  syncDatePickerSelection();
  
  // 不再重置激活的关键词和作者
  // 而是保持当前选择状态
  
  const container = document.getElementById('paperContainer');
  container.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading paper...</p>
    </div>
  `;
  
  try {
    const selectedLanguage = selectLanguageForDate(date);
    // 从 data 分支获取数据文件
    const dataUrl = getDataUrl(`data/${date}_AI_enhanced_${selectedLanguage}.jsonl`, dataSource);
    const response = await fetch(dataUrl);
    if (!isActiveDataRequest(requestId)) {
      return;
    }
    // 如果文件不存在（例如返回 404），在论文展示区域提示没有论文
    if (!response.ok) {
      if (response.status === 404) {
        container.innerHTML = `
          <div class="loading-container">
            <p>No papers found for this date.</p>
          </div>
        `;
        paperData = {};
        renderCategoryFilter({ sortedCategories: [], categoryCounts: {} });
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    // 空文件也提示没有论文
    if (!text || text.trim() === '') {
      container.innerHTML = `
        <div class="loading-container">
          <p>No papers found for this date.</p>
        </div>
      `;
      paperData = {};
      renderCategoryFilter({ sortedCategories: [], categoryCounts: {} });
      return;
    }
    
    paperData = parseJsonlData(text, date);
    if (!isActiveDataRequest(requestId)) {
      return;
    }
    
    const categories = getAllCategories(paperData);
    
    renderCategoryFilter(categories);
    
    renderPapers();
  } catch (error) {
    if (!isActiveDataRequest(requestId)) {
      return;
    }
    console.error('加载论文数据失败:', error);
    container.innerHTML = `
      <div class="loading-container">
        <p>Loading data fails. Please retry.</p>
        <p>Error messages: ${error.message}</p>
      </div>
    `;
  }
}

function parseJsonlData(jsonlText, date) {
  const result = {};
  
  const lines = jsonlText.trim().split('\n');
  
  lines.forEach(line => {
    try {
      const paper = JSON.parse(line);
      
      if (!paper.categories) {
        return;
      }
      
      let allCategories = Array.isArray(paper.categories) ? paper.categories : [paper.categories];
      
      const primaryCategory = allCategories[0];
      
      if (!result[primaryCategory]) {
        result[primaryCategory] = [];
      }
      
      const summary = paper.AI && paper.AI.tldr ? paper.AI.tldr : paper.summary;
      
      result[primaryCategory].push({
        title: paper.title,
        url: paper.abs || paper.url || paper.pdf || `https://arxiv.org/abs/${paper.id}`,
        abs_url: paper.abs || paper.url || '',
        pdf_url: paper.pdf || '',
        html_url: paper.url || '',
        authors: Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors,
        category: allCategories,
        summary: summary,
        details: paper.summary || '',
        date: date,
        id: paper.id,
        motivation: paper.AI && paper.AI.motivation ? paper.AI.motivation : '',
        method: paper.AI && paper.AI.method ? paper.AI.method : '',
        result: paper.AI && paper.AI.result ? paper.AI.result : '',
        conclusion: paper.AI && paper.AI.conclusion ? paper.AI.conclusion : '',
        code_url: paper.code_url || '',
        code_stars: paper.code_stars || 0,
        code_last_update: paper.code_last_update || ''
      });
    } catch (error) {
      console.error('解析JSON行失败:', error, line);
    }
  });
  
  return result;
}

// 获取所有类别并按偏好排序
function getAllCategories(data) {
  const categories = Object.keys(data);
  const catePaperCount = {};
  
  categories.forEach(category => {
    catePaperCount[category] = data[category] ? data[category].length : 0;
  });
  
  return {
    sortedCategories: categories.sort((a, b) => {
      return a.localeCompare(b);
    }),
    categoryCounts: catePaperCount
  };
}

function renderCategoryFilter(categories) {
  const container = document.querySelector('.category-scroll');
  const { sortedCategories, categoryCounts } = categories;
  
  let totalPapers = 0;
  Object.values(categoryCounts).forEach(count => {
    totalPapers += count;
  });
  
  container.innerHTML = `
    <button class="category-button ${currentCategory === 'all' ? 'active' : ''}" data-category="all">All<span class="category-count">${totalPapers}</span></button>
  `;
  
  sortedCategories.forEach(category => {
    const count = categoryCounts[category];
    const button = document.createElement('button');
    button.className = `category-button ${category === currentCategory ? 'active' : ''}`;
    button.innerHTML = `${category}<span class="category-count">${count}</span>`;
    button.dataset.category = category;
    button.addEventListener('click', () => {
      filterByCategory(category);
    });
    
    container.appendChild(button);
  });
  
  document.querySelector('.category-button[data-category="all"]').addEventListener('click', () => {
    filterByCategory('all');
  });
}

function filterByCategory(category) {
  currentCategory = category;
  
  document.querySelectorAll('.category-button').forEach(button => {
    button.classList.toggle('active', button.dataset.category === category);
  });
  
  // 保持当前激活的过滤标签
  renderFilterTags();
  
  // 重置页面滚动条到顶部
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
  
  renderPapers();
}

// 帮助函数：高亮文本中的匹配内容
function highlightMatches(text, terms, className = 'highlight-match') {
  if (!terms || terms.length === 0 || !text) {
    return text;
  }
  
  let result = text;
  
  // 按照长度排序关键词，从长到短，避免短词先替换导致长词匹配失败
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  
  // 为每个词创建一个正则表达式，使用 'gi' 标志进行全局、不区分大小写的匹配
  sortedTerms.forEach(term => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, `<span class="${className}">$1</span>`);
  });
  
  return result;
}

// 帮助函数：格式化作者列表（用于论文卡片显示）
// 规则：≤4个作者全部显示，>4个作者显示前2+后2，中间用省略号
function formatAuthorsForCard(authorsString, authorTerms = []) {
  if (!authorsString) {
    return '';
  }
  
  // 将作者字符串解析为数组（处理逗号分隔的情况）
  const authorsArray = authorsString.split(',').map(author => author.trim()).filter(author => author.length > 0);
  
  if (authorsArray.length === 0) {
    return '';
  }
  
  // 如果不超过4个作者，全部显示
  if (authorsArray.length <= 4) {
    return authorsArray.map(author => {
      // 对每个作者应用高亮
      const highlightedAuthor = authorTerms.length > 0 
        ? highlightMatches(author, authorTerms, 'author-highlight')
        : author;
      return `<span class="author-item">${highlightedAuthor}</span>`;
    }).join(', ');
  }
  
  // 超过4个作者：显示前2个、省略号、后2个
  const firstTwo = authorsArray.slice(0, 2);
  const lastTwo = authorsArray.slice(-2);
  
  const result = [];
  
  // 前2个作者
  firstTwo.forEach(author => {
    const highlightedAuthor = authorTerms.length > 0 
      ? highlightMatches(author, authorTerms, 'author-highlight')
      : author;
    result.push(`<span class="author-item">${highlightedAuthor}</span>`);
  });
  
  // 省略号
  result.push('<span class="author-ellipsis">...</span>');
  
  // 后2个作者
  lastTwo.forEach(author => {
    const highlightedAuthor = authorTerms.length > 0 
      ? highlightMatches(author, authorTerms, 'author-highlight')
      : author;
    result.push(`<span class="author-item">${highlightedAuthor}</span>`);
  });
  
  return result.join(', ');
}

function renderPapers() {
  const container = document.getElementById('paperContainer');
  container.innerHTML = '';
  container.className = `paper-container ${currentView === 'list' ? 'list-view' : ''}`;
  
  let papers = [];
  if (currentCategory === 'all') {
    const { sortedCategories } = getAllCategories(paperData);
    sortedCategories.forEach(category => {
      if (paperData[category]) {
        papers = papers.concat(paperData[category]);
      }
    });
  } else if (paperData[currentCategory]) {
    papers = paperData[currentCategory];
  }
  
  // 创建匹配论文的集合
  let filteredPapers = [...papers];

  // 重置所有论文的匹配状态，避免上次渲染的残留
  filteredPapers.forEach(p => {
    p.isMatched = false;
    p.matchReason = undefined;
  });

  // 文本搜索优先：当存在非空文本时，像关键词/作者一样只排序不隐藏
  if (textSearchQuery && textSearchQuery.trim().length > 0) {
    const q = textSearchQuery.toLowerCase();

    // 排序：匹配的排前
    filteredPapers.sort((a, b) => {
      const hayA = [
        a.title,
        a.authors,
        Array.isArray(a.category) ? a.category.join(', ') : a.category,
        a.summary,
        a.details || '',
        a.motivation || '',
        a.method || '',
        a.result || '',
        a.conclusion || ''
      ].join(' ').toLowerCase();
      const hayB = [
        b.title,
        b.authors,
        Array.isArray(b.category) ? b.category.join(', ') : b.category,
        b.summary,
        b.details || '',
        b.motivation || '',
        b.method || '',
        b.result || '',
        b.conclusion || ''
      ].join(' ').toLowerCase();
      const am = hayA.includes(q);
      const bm = hayB.includes(q);
      if (am && !bm) return -1;
      if (!am && bm) return 1;
      return 0;
    });

    // 标记匹配项，用于卡片样式与提示
    filteredPapers.forEach(p => {
      const hay = [
        p.title,
        p.authors,
        Array.isArray(p.category) ? p.category.join(', ') : p.category,
        p.summary,
        p.details || '',
        p.motivation || '',
        p.method || '',
        p.result || '',
        p.conclusion || ''
      ].join(' ').toLowerCase();
      const matched = hay.includes(q);
      p.isMatched = matched;
      p.matchReason = matched ? [`文本: ${textSearchQuery}`] : undefined;
    });
  } else {
    // 关键词和作者匹配，但不过滤，只排序
    if (activeKeywords.length > 0 || activeAuthors.length > 0) {
      // 对论文进行排序，将匹配的论文放在前面
      filteredPapers.sort((a, b) => {
        const aMatchesKeyword = activeKeywords.length > 0 ? 
          activeKeywords.some(keyword => {
            // 仅在标题和摘要中搜索关键词
            const searchText = `${a.title} ${a.summary}`.toLowerCase();
            return searchText.includes(keyword.toLowerCase());
          }) : false;
          
        const aMatchesAuthor = activeAuthors.length > 0 ?
          activeAuthors.some(author => {
            // 仅在作者中搜索作者名
            return a.authors.toLowerCase().includes(author.toLowerCase());
          }) : false;
          
        const bMatchesKeyword = activeKeywords.length > 0 ?
          activeKeywords.some(keyword => {
            // 仅在标题和摘要中搜索关键词
            const searchText = `${b.title} ${b.summary}`.toLowerCase();
            return searchText.includes(keyword.toLowerCase());
          }) : false;
          
        const bMatchesAuthor = activeAuthors.length > 0 ?
          activeAuthors.some(author => {
            // 仅在作者中搜索作者名
            return b.authors.toLowerCase().includes(author.toLowerCase());
          }) : false;
      
        // a和b的匹配状态（关键词或作者匹配都算）
        const aMatches = aMatchesKeyword || aMatchesAuthor;
        const bMatches = bMatchesKeyword || bMatchesAuthor;
        
        if (aMatches && !bMatches) return -1;
        if (!aMatches && bMatches) return 1;
        return 0;
      });
      
      // 标记匹配的论文
      filteredPapers.forEach(paper => {
        const matchesKeyword = activeKeywords.length > 0 ?
          activeKeywords.some(keyword => {
            const searchText = `${paper.title} ${paper.summary}`.toLowerCase();
            return searchText.includes(keyword.toLowerCase());
          }) : false;
          
        const matchesAuthor = activeAuthors.length > 0 ?
          activeAuthors.some(author => {
            return paper.authors.toLowerCase().includes(author.toLowerCase());
          }) : false;
          
        // 添加匹配标记（用于后续高亮整个论文卡片）
        paper.isMatched = matchesKeyword || matchesAuthor;
        
        // 添加匹配原因（用于显示匹配提示）
        if (paper.isMatched) {
          paper.matchReason = [];
          if (matchesKeyword) {
            const matchedKeywords = activeKeywords.filter(keyword => 
              `${paper.title} ${paper.summary}`.toLowerCase().includes(keyword.toLowerCase())
            );
            if (matchedKeywords.length > 0) {
              paper.matchReason.push(`关键词: ${matchedKeywords.join(', ')}`);
            }
          }
          if (matchesAuthor) {
            const matchedAuthors = activeAuthors.filter(author => 
              paper.authors.toLowerCase().includes(author.toLowerCase())
            );
            if (matchedAuthors.length > 0) {
              paper.matchReason.push(`作者: ${matchedAuthors.join(', ')}`);
            }
          }
        }
      });
    }
  }
  
  // 关键词和作者匹配，但不过滤，只排序
  if (activeKeywords.length > 0 || activeAuthors.length > 0) {
    // 对论文进行排序，将匹配的论文放在前面
    filteredPapers.sort((a, b) => {
      const aMatchesKeyword = activeKeywords.length > 0 ? 
        activeKeywords.some(keyword => {
          // 仅在标题和摘要中搜索关键词
          const searchText = `${a.title} ${a.summary}`.toLowerCase();
          return searchText.includes(keyword.toLowerCase());
        }) : false;
        
      const aMatchesAuthor = activeAuthors.length > 0 ?
        activeAuthors.some(author => {
          // 仅在作者中搜索作者名
          return a.authors.toLowerCase().includes(author.toLowerCase());
        }) : false;
        
      const bMatchesKeyword = activeKeywords.length > 0 ?
        activeKeywords.some(keyword => {
          // 仅在标题和摘要中搜索关键词
          const searchText = `${b.title} ${b.summary}`.toLowerCase();
          return searchText.includes(keyword.toLowerCase());
        }) : false;
        
      const bMatchesAuthor = activeAuthors.length > 0 ?
        activeAuthors.some(author => {
          // 仅在作者中搜索作者名
          return b.authors.toLowerCase().includes(author.toLowerCase());
        }) : false;
      
      // a和b的匹配状态（关键词或作者匹配都算）
      const aMatches = aMatchesKeyword || aMatchesAuthor;
      const bMatches = bMatchesKeyword || bMatchesAuthor;
      
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
    
    // 标记匹配的论文
    filteredPapers.forEach(paper => {
      const matchesKeyword = activeKeywords.length > 0 ?
        activeKeywords.some(keyword => {
          const searchText = `${paper.title} ${paper.summary}`.toLowerCase();
          return searchText.includes(keyword.toLowerCase());
        }) : false;
        
      const matchesAuthor = activeAuthors.length > 0 ?
        activeAuthors.some(author => {
          return paper.authors.toLowerCase().includes(author.toLowerCase());
        }) : false;
        
      // 添加匹配标记（用于后续高亮整个论文卡片）
      paper.isMatched = matchesKeyword || matchesAuthor;
      
      // 添加匹配原因（用于显示匹配提示）
      if (paper.isMatched) {
        paper.matchReason = [];
        if (matchesKeyword) {
          const matchedKeywords = activeKeywords.filter(keyword => 
            `${paper.title} ${paper.summary}`.toLowerCase().includes(keyword.toLowerCase())
          );
          if (matchedKeywords.length > 0) {
            paper.matchReason.push(`关键词: ${matchedKeywords.join(', ')}`);
          }
        }
        if (matchesAuthor) {
          const matchedAuthors = activeAuthors.filter(author => 
            paper.authors.toLowerCase().includes(author.toLowerCase())
          );
          if (matchedAuthors.length > 0) {
            paper.matchReason.push(`作者: ${matchedAuthors.join(', ')}`);
          }
        }
      }
    });
  }
  
  // 存储当前过滤后的论文列表，用于箭头键导航
  currentFilteredPapers = [...filteredPapers];
  updatePaperNavigationControls();
  
  if (filteredPapers.length === 0) {
    container.innerHTML = `
      <div class="loading-container">
        <p>No paper found.</p>
      </div>
    `;
    return;
  }
  
  filteredPapers.forEach((paper, index) => {
    const paperCard = document.createElement('div');
    const apsInfo = getApsPaperInfo(paper, currentDataSource);
    // 添加匹配高亮类
    paperCard.className = `paper-card ${paper.isMatched ? 'matched-paper' : ''}`;
    paperCard.dataset.id = paper.id || paper.url;
    
    if (paper.isMatched) {
      // 添加匹配原因提示
      paperCard.title = `匹配: ${paper.matchReason.join(' | ')}`;
    }
    
    const categoryTags = paper.allCategories ? 
      paper.allCategories.map(cat => `<span class="category-tag">${cat}</span>`).join('') : 
      `<span class="category-tag">${paper.category}</span>`;
    
    // 组合需要高亮的词：关键词 + 文本搜索
    const titleSummaryTerms = [];
    if (activeKeywords.length > 0) {
      titleSummaryTerms.push(...activeKeywords);
    }
    if (textSearchQuery && textSearchQuery.trim().length > 0) {
      titleSummaryTerms.push(textSearchQuery.trim());
    }

    // 高亮标题和摘要（关键词与文本搜索）
    const highlightedTitle = titleSummaryTerms.length > 0 
      ? highlightMatches(paper.title, titleSummaryTerms, 'keyword-highlight') 
      : paper.title;
    const highlightedSummary = titleSummaryTerms.length > 0 
      ? highlightMatches(paper.summary, titleSummaryTerms, 'keyword-highlight') 
      : paper.summary;

    // 高亮作者（作者过滤 + 文本搜索）
    const authorTerms = [];
    if (activeAuthors.length > 0) authorTerms.push(...activeAuthors);
    if (textSearchQuery && textSearchQuery.trim().length > 0) authorTerms.push(textSearchQuery.trim());
    
    // 格式化作者列表（应用截断规则和高亮）
    const formattedAuthors = formatAuthorsForCard(paper.authors, authorTerms);
    
    // 构建 GitHub 按钮 HTML
    // let githubHtml = '';
    // if (paper.code_url) {
    //   const stars = paper.code_stars ? `<span class="github-stars">★ ${paper.code_stars}</span>` : '';
    //   const isHot = paper.code_stars > 100;
      
    //   githubHtml = `
    //     <a href="${paper.code_url}" target="_blank" class="github-link" title="View Code" onclick="event.stopPropagation()">
    //       <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom; margin-right: 4px;">
    //         <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
    //       </svg>
    //       Code ${stars}
    //       ${isHot ? '<span class="hot-icon">🔥</span>' : ''}
    //     </a>
    //   `;
    // }

    paperCard.innerHTML = `
      <div class="paper-card-index">${index + 1}</div>
      ${paper.isMatched ? '<div class="match-badge" title="匹配您的搜索条件"></div>' : ''}
      <div class="paper-card-header">
        <h3 class="paper-card-title">${highlightedTitle}</h3>
        <p class="paper-card-authors">${formattedAuthors}</p>
        <div class="paper-card-categories">
          ${categoryTags}
        </div>
      </div>
      <div class="paper-card-body">
        <p class="paper-card-summary">${highlightedSummary}</p>
        <div class="paper-card-footer">
          <div class="footer-left">
            <span class="paper-card-date">${formatDate(paper.date)}</span>
          </div>
          <span class="paper-card-link">${apsInfo ? 'Open APS' : 'Details'}</span>
        </div>
      </div>
    `;
    
    paperCard.addEventListener('click', () => {
      if (apsInfo) {
        window.open(apsInfo.abstractUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      currentPaperIndex = index; // 记录当前点击的论文索引
      showPaperDetails(paper, index + 1);
    });
    
    container.appendChild(paperCard);
  });
}

function showPaperDetails(paper, paperIndex) {
  const modal = document.getElementById('paperModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const paperLink = document.getElementById('paperLink');
  const pdfLink = document.getElementById('pdfLink');
  const htmlLink = document.getElementById('htmlLink');
  const paperUrl = getPaperDetailUrl(paper, currentDataSource);
  const pdfUrl = getPaperPdfUrl(paper, currentDataSource);
  const htmlUrl = getPaperHtmlUrl(paper, currentDataSource);
  const mobilePdfLink = document.body.classList.contains('reading-room') ? `
    <a class="mobile-pdf-link" href="${pdfUrl}" target="_blank" rel="noopener" aria-label="Open the complete PDF in a new tab">
      <span class="mobile-pdf-link-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
      </span>
      <span><strong>OPEN FULL PDF</strong><small>View the complete paper in a new tab</small></span>
      <span class="mobile-pdf-link-arrow" aria-hidden="true">→</span>
    </a>` : '';
  
  // 重置模态框的滚动位置
  modalBody.scrollTop = 0;
  
  // 组合高亮词：关键词 + 文本搜索
  const modalTitleTerms = [];
  if (activeKeywords.length > 0) modalTitleTerms.push(...activeKeywords);
  if (textSearchQuery && textSearchQuery.trim().length > 0) modalTitleTerms.push(textSearchQuery.trim());
  // 高亮标题
  const highlightedTitle = modalTitleTerms.length > 0 
    ? highlightMatches(paper.title, modalTitleTerms, 'keyword-highlight') 
    : paper.title;
  
  // 在标题前添加索引号
  modalTitle.innerHTML = paperIndex ? `<span class="paper-index-badge">${paperIndex}</span> ${highlightedTitle}` : highlightedTitle;
  
  const abstractText = paper.details || '';
  
  const categoryDisplay = paper.allCategories ? 
    paper.allCategories.join(', ') : 
    paper.category;
  
  // 高亮作者（作者过滤 + 文本搜索）
  const modalAuthorTerms = [];
  if (activeAuthors.length > 0) modalAuthorTerms.push(...activeAuthors);
  if (textSearchQuery && textSearchQuery.trim().length > 0) modalAuthorTerms.push(textSearchQuery.trim());
  const highlightedAuthors = modalAuthorTerms.length > 0 
    ? highlightMatches(paper.authors, modalAuthorTerms, 'author-highlight') 
    : paper.authors;
  
  // 高亮摘要（关键词 + 文本搜索）
  const highlightedSummary = modalTitleTerms.length > 0 
    ? highlightMatches(paper.summary, modalTitleTerms, 'keyword-highlight') 
    : paper.summary;
  
  // 高亮详情（Abstract/details）
  const highlightedAbstract = modalTitleTerms.length > 0 
    ? highlightMatches(abstractText, modalTitleTerms, 'keyword-highlight') 
    : abstractText;
  
  // 高亮其他部分（如果存在且是摘要的一部分）
  const highlightedMotivation = paper.motivation && modalTitleTerms.length > 0 
    ? highlightMatches(paper.motivation, modalTitleTerms, 'keyword-highlight') 
    : paper.motivation;
  
  const highlightedMethod = paper.method && modalTitleTerms.length > 0 
    ? highlightMatches(paper.method, modalTitleTerms, 'keyword-highlight') 
    : paper.method;
  
  const highlightedResult = paper.result && modalTitleTerms.length > 0 
    ? highlightMatches(paper.result, modalTitleTerms, 'keyword-highlight') 
    : paper.result;
  
  const highlightedConclusion = paper.conclusion && modalTitleTerms.length > 0 
    ? highlightMatches(paper.conclusion, modalTitleTerms, 'keyword-highlight') 
    : paper.conclusion;
  
  // 判断是否需要显示高亮说明
  const showHighlightLegend = activeKeywords.length > 0 || activeAuthors.length > 0;
  
  // 添加匹配标记
  const matchedPaperClass = paper.isMatched ? 'matched-paper-details' : '';
  
  const modalContent = `
    <div class="paper-details ${matchedPaperClass}">
      <p><strong>Authors: </strong>${highlightedAuthors}</p>
      <p><strong>Categories: </strong>${categoryDisplay}</p>
      <p><strong>Date: </strong>${formatDate(paper.date)}</p>
      
      
      <h3>TL;DR</h3>
      <p>${highlightedSummary}</p>
      
      <div class="paper-sections">
        ${paper.motivation ? `<div class="paper-section"><h4>Motivation</h4><p>${highlightedMotivation}</p></div>` : ''}
        ${paper.method ? `<div class="paper-section"><h4>Method</h4><p>${highlightedMethod}</p></div>` : ''}
        ${paper.result ? `<div class="paper-section"><h4>Result</h4><p>${highlightedResult}</p></div>` : ''}
        ${paper.conclusion ? `<div class="paper-section"><h4>Conclusion</h4><p>${highlightedConclusion}</p></div>` : ''}
      </div>
      
      ${highlightedAbstract ? `<h3>Abstract</h3><p class="original-abstract">${highlightedAbstract}</p>` : ''}
      
      <div class="pdf-preview-section">
        ${mobilePdfLink}
        <div class="pdf-header">
          <h3>PDF Preview</h3>
          <button class="pdf-expand-btn" onclick="togglePdfSize(this)">
            <svg class="expand-icon" viewBox="0 0 24 24" width="24" height="24">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
            <svg class="collapse-icon" viewBox="0 0 24 24" width="24" height="24" style="display: none;">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
            </svg>
          </button>
        </div>
        <div class="pdf-container">
          <iframe src="${pdfUrl}" width="100%" height="1200px" frameborder="0"></iframe>
        </div>
      </div>
    </div>
  `;
  
  // Update modal content
  document.getElementById('modalBody').innerHTML = modalContent;
  paperLink.href = paperUrl;
  pdfLink.href = pdfUrl;
  htmlLink.href = htmlUrl;
  
  // --- GitHub Button Logic ---
  const githubLink = document.getElementById('githubLink');
  
  if (paper.code_url) {
    githubLink.href = paper.code_url;
    githubLink.style.display = 'flex'; 
    githubLink.title = "View Code on GitHub";
  } else {
    githubLink.style.display = 'none';
  }
  // ---------------------------

  // 提示词来自：https://papers.cool/
  prompt = `请你阅读这篇文章${pdfUrl},总结一下这篇文章解决的问题、相关工作、研究方法、做了什么实验及其结果、结论，最后整体总结一下这篇文章的内容`
  document.getElementById('kimiChatLink').href = `https://www.kimi.com/_prefill_chat?prefill_prompt=${prompt}&system_prompt=你是一个学术助手，后面的对话将围绕着以下论文内容进行，已经通过链接给出了论文的PDF和论文已有的FAQ。用户将继续向你咨询论文的相关问题，请你作出专业的回答，不要出现第一人称，当涉及到分点回答时，鼓励你以markdown格式输出。&send_immediately=true&force_search=true`;
  
  // 更新论文位置信息
  const paperPosition = document.getElementById('paperPosition');
  if (paperPosition && currentFilteredPapers.length > 0) {
    paperPosition.textContent = `${currentPaperIndex + 1} / ${currentFilteredPapers.length}`;
  } else if (paperPosition) {
    paperPosition.textContent = '-';
  }
  updatePaperNavigationControls();
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  MathJax.typeset();
}

function closeModal() {
  const modal = document.getElementById('paperModal');
  const modalBody = document.getElementById('modalBody');
  
  // 重置模态框的滚动位置
  modalBody.scrollTop = 0;
  resetPaperModalSize();
  
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// 导航到上一篇论文
function navigateToPreviousPaper() {
  if (currentFilteredPapers.length <= 1) return;
  
  currentPaperIndex = currentPaperIndex > 0 ? currentPaperIndex - 1 : currentFilteredPapers.length - 1;
  const paper = currentFilteredPapers[currentPaperIndex];
  showPaperDetails(paper, currentPaperIndex + 1);
}

// 导航到下一篇论文
function navigateToNextPaper() {
  if (currentFilteredPapers.length <= 1) return;
  
  currentPaperIndex = currentPaperIndex < currentFilteredPapers.length - 1 ? currentPaperIndex + 1 : 0;
  const paper = currentFilteredPapers[currentPaperIndex];
  showPaperDetails(paper, currentPaperIndex + 1);
}

function updatePaperNavigationControls() {
  const isNavigationAvailable = currentFilteredPapers.length > 1;
  document.querySelectorAll('[data-paper-nav="prev"]').forEach(button => {
    button.disabled = !isNavigationAvailable;
  });
  document.querySelectorAll('[data-paper-nav="next"]').forEach(button => {
    button.disabled = !isNavigationAvailable;
  });
}

// 显示随机论文
function showRandomPaper() {
  // 检查是否有可用的论文
  if (currentFilteredPapers.length === 0) {
    console.log('No papers available to show random paper');
    return;
  }
  
  // 生成随机索引
  const randomIndex = Math.floor(Math.random() * currentFilteredPapers.length);
  const randomPaper = currentFilteredPapers[randomIndex];
  
  // 更新当前论文索引
  currentPaperIndex = randomIndex;
  
  // 显示随机论文
  showPaperDetails(randomPaper, currentPaperIndex + 1);
  
  // 显示随机论文指示器
  showRandomPaperIndicator();
  
  console.log(`Showing random paper: ${randomIndex + 1}/${currentFilteredPapers.length}`);
}

// 显示随机论文指示器
function showRandomPaperIndicator() {
  // 移除已存在的指示器
  const existingIndicator = document.querySelector('.random-paper-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  // 创建新的指示器
  const indicator = document.createElement('div');
  indicator.className = 'random-paper-indicator';
  indicator.textContent = 'Random Paper';
  
  // 添加到页面
  document.body.appendChild(indicator);
  
  // 3秒后自动移除
  setTimeout(() => {
    if (indicator && indicator.parentNode) {
      indicator.remove();
    }
  }, 3000);
}

function setDatePickerOpen(isOpen) {
  const datePicker = document.getElementById('datePickerModal');
  if (!datePicker) return;

  datePicker.classList.toggle('active', isOpen);
  
  if (isOpen) {
    document.body.style.overflow = 'hidden';
    
    // 重新初始化日期选择器以确保它反映最新的可用日期
    syncDatePickerSelection();
  } else {
    document.body.style.overflow = '';
  }
}

function openDatePicker() {
  setDatePickerOpen(true);
}

function closeDatePicker() {
  setDatePickerOpen(false);
}

function toggleDatePicker() {
  const datePicker = document.getElementById('datePickerModal');
  if (!datePicker) return;
  setDatePickerOpen(!datePicker.classList.contains('active'));
}

function toggleView() {
  currentView = currentView === 'grid' ? 'list' : 'grid';
  document.getElementById('paperContainer').classList.toggle('list-view', currentView === 'list');
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

async function loadPapersByDateRange(startDate, endDate, requestId = activeDataRequestId, dataSource = currentDataSource) {
  if (!isActiveDataRequest(requestId)) {
    return;
  }

  // 获取日期范围内的所有有效日期
  const validDatesInRange = availableDates.filter(date => {
    return date >= startDate && date <= endDate;
  });
  
  if (validDatesInRange.length === 0) {
    alert('No available papers in the selected date range.');
    return;
  }
  
  currentDate = `${startDate} to ${endDate}`;
  document.getElementById('currentDate').textContent = `${dataSource.showname || dataSource.name} · ${formatDate(startDate)} - ${formatDate(endDate)}`;
  
  // 不再重置激活的关键词和作者
  // 而是保持当前选择状态
  
  const container = document.getElementById('paperContainer');
  container.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading papers from ${formatDate(startDate)} to ${formatDate(endDate)}...</p>
    </div>
  `;
  
  try {
    // 加载所有日期的论文数据
    const allPaperData = {};
    
    for (const date of validDatesInRange) {
      const selectedLanguage = selectLanguageForDate(date);
      // 从 data 分支获取数据文件
      const dataUrl = getDataUrl(`data/${date}_AI_enhanced_${selectedLanguage}.jsonl`, dataSource);
      const response = await fetch(dataUrl);
      if (!isActiveDataRequest(requestId)) {
        return;
      }
      if (!response.ok) {
        if (response.status === 404) {
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (!text || !text.trim()) {
        continue;
      }
      const dataPapers = parseJsonlData(text, date);
      
      // 合并数据
      Object.keys(dataPapers).forEach(category => {
        if (!allPaperData[category]) {
          allPaperData[category] = [];
        }
        allPaperData[category] = allPaperData[category].concat(dataPapers[category]);
      });
    }
    
    paperData = allPaperData;
    if (!isActiveDataRequest(requestId)) {
      return;
    }
    
    const categories = getAllCategories(paperData);
    
    renderCategoryFilter(categories);
    
    renderPapers();
  } catch (error) {
    if (!isActiveDataRequest(requestId)) {
      return;
    }
    console.error('加载论文数据失败:', error);
    container.innerHTML = `
      <div class="loading-container">
        <p>Loading data fails. Please retry.</p>
        <p>Error messages: ${error.message}</p>
      </div>
    `;
  }
}

// 清除所有激活的关键词
function clearAllKeywords() {
  activeKeywords = [];
  // renderKeywordTags();
  // 重新渲染论文列表，移除关键词匹配的高亮和优先排序
  renderPapers();
}

// 清除所有作者过滤
function clearAllAuthors() {
  activeAuthors = [];
  renderFilterTags();
  // 重新渲染论文列表，移除作者匹配的高亮和优先排序
  renderPapers();
}

// 切换PDF预览器大小
function togglePdfSize(button) {
  const pdfContainer = button.closest('.pdf-preview-section').querySelector('.pdf-container');
  const iframe = pdfContainer.querySelector('iframe');
  const expandIcon = button.querySelector('.expand-icon');
  const collapseIcon = button.querySelector('.collapse-icon');

  if (pdfContainer.classList.contains('expanded')) {
    // 恢复正常大小
    pdfContainer.classList.remove('expanded');
    iframe.style.height = '800px';
    expandIcon.style.display = 'block';
    collapseIcon.style.display = 'none';

    // 移除遮罩层
    const overlay = document.querySelector('.pdf-overlay');
    if (overlay) {
      overlay.remove();
    }
  } else {
    // 放大显示
    pdfContainer.classList.add('expanded');
    iframe.style.height = '90vh';
    expandIcon.style.display = 'none';
    collapseIcon.style.display = 'block';

    // 添加遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'pdf-overlay';
    document.body.appendChild(overlay);

    // 点击遮罩层时收起PDF
    overlay.addEventListener('click', () => {
      togglePdfSize(button);
    });
  }
}

// 主题切换功能
const ThemeManager = {
  STORAGE_KEY: 'theme',
  THEMES: {
    LIGHT: 'light',
    DARK: 'dark'
  },

  init() {
    this.loadTheme();
    this.setupToggle();
  },

  loadTheme() {
    const savedTheme = localStorage.getItem(this.STORAGE_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 默认使用保存的主题，否则根据系统偏好，否则使用亮色主题
    let theme = savedTheme || (prefersDark ? this.THEMES.DARK : this.THEMES.LIGHT);
    this.setTheme(theme);
  },

  setTheme(theme) {
    const isDark = theme === this.THEMES.DARK;
    document.body.classList.toggle('theme-dark', isDark);
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.updateIcon(isDark);
  },

  updateIcon(isDark) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;

    // 月亮图标路径（暗色主题）
    const moonPath = 'M9.37,5.51C9.19,6.15,9.1,6.82,9.1,7.5c0,4.08,3.32,7.4,7.4,7.4c0.68,0,1.35-0.09,1.99-0.27C17.45,17.55,14.26,19,10.8,19c-5.5,0-10-4.5-10-10 c0-3.46,1.45-6.65,3.84-8.9C5.1,2.13,5.59,2.5,6.03,2.93C2.93,5.08,1,8.3,1,12c0,5.5,4.5,10,10,10c3.7,0,6.92-1.93,8.77-4.84 c0.43,0.44,0.91,0.79,1.47,1.07C19.55,21.45,16.26,23,12.5,23C6.15,23,1,17.85,1,11.5C1,7.74,2.55,4.45,4.93,2.26 c0.28,0.56,0.63,1.04,1.07,1.47C5.08,5.07,5.5,5.1,5.92,5.1C6.7,5.1,7.46,5.26,8.17,5.56C8.54,5.41,8.96,5.51,9.37,5.51z';
    // 太阳图标路径（亮色主题）
    const sunPath = 'M12,7c-2.76,0-5,2.24-5,5s2.24,5,5,5s5-2.24,5-5S14.76,7,12,7z M12,2L9,5l3,3l3-3L12,2z M12,22l3-3l-3-3l-3,3L12,22z M22,12l-3-3l-3,3l3,3L22,12z M2,12l3,3l3-3l-3-3L2,12z M5,9l3-3l-3-3L2,5L5,9z M19,9l3-3l-3-3l-3,3L19,9z M5,15l-3,3l3,3l3-3L5,15z M19,15l-3,3l3,3l3-3L19,15z';

    const path = icon.querySelector('path');
    if (path) {
      path.setAttribute('d', isDark ? sunPath : moonPath);
      // 更新提示文本
      icon.closest('button').setAttribute('title', isDark ? '切换到亮色主题' : '切换到深色主题');
    }
  },

  setupToggle() {
    const toggleButton = document.getElementById('themeToggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', () => {
        const isDark = document.body.classList.contains('theme-dark');
        this.setTheme(isDark ? this.THEMES.LIGHT : this.THEMES.DARK);
      });
    }
  }
};

// 初始化主题管理器
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
});
