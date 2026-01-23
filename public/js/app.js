const API_BASE = '/api';

// WebSocket connection
let socket = null;

const state = {
  user: null,
  auctions: [],
  currentAuction: null,
  currentTab: 'active',
  timerInterval: null,
  refreshInterval: null,
};

// Initialize WebSocket connection
function initWebSocket() {
  if (typeof io === 'undefined') {
    console.warn('Socket.io not loaded, skipping WebSocket');
    return;
  }

  socket = io();

  socket.on('connect', () => {
    console.log('WebSocket connected');
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
  });

  // Auction started - refresh auction list
  socket.on('auction:start', (data) => {
    console.log('Auction started:', data);
    loadAuctions();
    // If viewing this auction, refresh detail
    if (state.currentAuction?.id === data.auctionId) {
      forceRefreshAuctionData();
    }
  });

  // Round ended
  socket.on('round:end', (data) => {
    console.log('Round ended:', data);
    if (state.currentAuction?.id === data.auctionId) {
      forceRefreshAuctionData();
    }
  });

  // Round started
  socket.on('round:start', (data) => {
    console.log('Round started:', data);
    if (state.currentAuction?.id === data.auctionId) {
      forceRefreshAuctionData();
    }
  });

  // Auction completed
  socket.on('auction:complete', (data) => {
    console.log('Auction completed:', data);
    loadAuctions();
    if (state.currentAuction?.id === data.auctionId) {
      forceRefreshAuctionData();
    }
  });

  // New bid
  socket.on('bid:new', (data) => {
    console.log('New bid:', data);
    // Only update leaderboard, don't refresh whole page
  });

  // Anti-snipe triggered
  socket.on('timer:antiSnipe', (data) => {
    console.log('Anti-snipe triggered:', data);
    if (state.currentAuction?.id === data.auctionId) {
      // Update timer with new end time
      if (state.currentAuction.activeRound) {
        state.currentAuction.activeRound.endAt = data.newEndAt;
      }
    }
  });

  // Leaderboard update
  socket.on('leaderboard:update', (data) => {
    console.log('Leaderboard updated:', data);
  });
}

// Join auction room for real-time updates
function joinAuctionRoom(auctionId) {
  if (socket && socket.connected) {
    socket.emit('join:auction', auctionId);
    console.log('Joined auction room:', auctionId);
  }
}

// Leave auction room
function leaveAuctionRoom(auctionId) {
  if (socket && socket.connected) {
    socket.emit('leave:auction', auctionId);
    console.log('Left auction room:', auctionId);
  }
}

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.user) {
    headers['X-User-Id'] = state.user.id;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error);
  }
  return data.data;
}

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function formatNumber(num) {
  return num.toLocaleString('ru-RU');
}

function formatDate(date) {
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimer(ms) {
  if (ms <= 0) return '00:00:00';
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function showPage(pageId) {
  $$('.page').forEach(p => p.classList.add('hidden'));
  $(`#${pageId}Page`).classList.remove('hidden');

  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeNav = $(`.nav-btn[data-page="${pageId}"]`) || $(`.nav-btn[data-page="auctions"]`);
  activeNav?.classList.add('active');
}

function renderUserInfo() {
  const container = $('#userInfo');
  if (!state.user) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <span>${state.user.username}</span>
    <div class="balance">
      <span class="balance-star">⭐</span>
      <span>${formatNumber(state.user.balance)}</span>
    </div>
    <button class="deposit-btn" onclick="deposit()">+1000</button>
  `;
}

async function login() {
  const username = $('#usernameInput').value.trim();
  if (!username) return;

  try {
    const user = await api('/users/login', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

    state.user = user;
    localStorage.setItem('user', JSON.stringify(user));
    renderUserInfo();
    showPage('auctions');
    loadAuctions();
  } catch (err) {
    alert(err.message);
  }
}

async function deposit() {
  try {
    const user = await api('/users/me/deposit', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
    });
    state.user = user;
    renderUserInfo();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAuctions() {
  try {
    state.auctions = await api('/auctions');
    renderAuctions();
  } catch (err) {
    console.error(err);
  }
}

function renderAuctions() {
  const container = $('#auctionsList');
  const filtered = state.auctions.filter(a => a.status === state.currentTab);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет аукционов</div>';
    return;
  }

  container.innerHTML = filtered.map(a => `
    <div class="auction-card" onclick="openAuction('${a.id}')">
      <div class="auction-header">
        <span class="auction-name">${a.name}</span>
        <span class="auction-status status-${a.status}">${getStatusLabel(a.status)}</span>
      </div>
      <div class="auction-stats">
        <div class="stat">
          <span class="stat-label">Подарков</span>
          <span class="stat-value">${formatNumber(a.distributedItems)} / ${formatNumber(a.totalItems)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Раунд</span>
          <span class="stat-value">${a.currentRound} / ${a.totalRounds}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Средняя цена</span>
          <span class="stat-value">⭐ ${formatNumber(Math.round(a.avgPrice))}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Старт</span>
          <span class="stat-value">${formatDate(a.startAt)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function getStatusLabel(status) {
  const labels = {
    active: 'Активен',
    pending: 'Ожидает',
    completed: 'Завершён',
  };
  return labels[status] || status;
}

async function openAuction(id) {
  try {
    // Leave previous auction room if any
    if (state.currentAuction) {
      leaveAuctionRoom(state.currentAuction.id);
    }

    state.currentAuction = await api(`/auctions/${id}`);
    showPage('auction');
    renderAuctionDetail();
    startAuctionRefresh();

    // Join auction room for real-time updates
    joinAuctionRoom(id);
  } catch (err) {
    alert(err.message);
  }
}

function startAuctionRefresh() {
  stopAuctionRefresh();

  state.timerInterval = setInterval(updateTimer, 1000);
  // Reduced refresh frequency to 5 seconds to prevent page jumping
  state.refreshInterval = setInterval(async () => {
    if (state.currentAuction) {
      await refreshAuctionData();
    }
  }, 5000);
}

function stopAuctionRefresh() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    state.refreshInterval = null;
  }
}

async function refreshAuctionData() {
  try {
    const [auction, myBid, leaderboard] = await Promise.all([
      api(`/auctions/${state.currentAuction.id}`),
      api(`/auctions/${state.currentAuction.id}/my-bid`),
      api(`/auctions/${state.currentAuction.id}/leaderboard?limit=3`),
    ]);

    // Check if round changed
    const previousRound = state.currentAuction?.activeRound?.roundNumber;
    state.currentAuction = auction;
    const newRound = auction?.activeRound?.roundNumber;

    // If round changed, we MUST re-render (new round = new settings)
    if (previousRound !== newRound) {
      renderAuctionDetail(myBid, leaderboard);
      return;
    }

    // Otherwise, just update text values without re-rendering DOM
    // This prevents scroll jumping
    updatePartialUI(auction, myBid, leaderboard);

  } catch (err) {
    console.error(err);
  }
}

// Force full re-render (used after placing bid)
async function forceRefreshAuctionData() {
  try {
    const [auction, myBid, leaderboard] = await Promise.all([
      api(`/auctions/${state.currentAuction.id}`),
      api(`/auctions/${state.currentAuction.id}/my-bid`),
      api(`/auctions/${state.currentAuction.id}/leaderboard?limit=3`),
    ]);

    state.currentAuction = auction;
    renderAuctionDetail(myBid, leaderboard);
  } catch (err) {
    console.error(err);
  }
}

// Update only text content without re-rendering DOM structure
function updatePartialUI(auction, myBid, leaderboard) {
  // Update timer
  const timerEl = $('.timer-value');
  if (timerEl && auction?.activeRound) {
    const endAt = new Date(auction.activeRound.endAt).getTime();
    const remaining = endAt - Date.now();
    timerEl.textContent = formatTimer(remaining);
  }

  // Update my bid rank if present
  if (myBid) {
    const rankEl = document.querySelector('.user-rank.gold, .user-rank.silver, .user-rank.bronze, .user-rank.normal');
    if (rankEl) {
      rankEl.textContent = myBid.rank;
    }
  }
}

function updateTimer() {
  const timerEl = $('.timer-value');
  if (!timerEl || !state.currentAuction?.activeRound) return;

  const endAt = new Date(state.currentAuction.activeRound.endAt).getTime();
  const now = Date.now();
  const remaining = endAt - now;

  timerEl.textContent = formatTimer(remaining);
}

async function renderAuctionDetail(myBid = null, leaderboard = null) {
  const a = state.currentAuction;
  if (!a) return;

  // Save scroll position before re-render
  const scrollY = window.scrollY;

  // Preserve current slider value
  const sliderEl = $('#bidSlider');
  const savedSliderValue = sliderEl ? parseInt(sliderEl.value, 10) : (a.minBid || 1);

  if (!myBid && a.status === 'active') {
    try {
      myBid = await api(`/auctions/${a.id}/my-bid`);
    } catch { }
  }

  if (!leaderboard && a.status === 'active') {
    try {
      leaderboard = await api(`/auctions/${a.id}/leaderboard?limit=3`);
    } catch { }
  }

  const container = $('#auctionDetail');
  const remaining = a.activeRound ? new Date(a.activeRound.endAt).getTime() - Date.now() : 0;

  const minBid = a.minBid || 1;
  const maxBid = 200000;
  const currentValue = myBid ? myBid.amount : savedSliderValue || minBid;
  const minBidForWin = a.activeRound?.minBidForWin || 1;
  const winnersCount = a.activeRound?.winnersCount || a.itemsPerRound;
  const isInTop = currentValue >= minBidForWin;

  container.innerHTML = `
    <div class="auction-detail-card" style="background: transparent;">
      <!-- Header with glass buttons -->
      <div class="auction-detail-header" style="position: relative;">
        <div class="auction-detail-icon check-bounce">🎁</div>
        <div class="auction-badge">Аукцион</div>
        <div class="auction-detail-name">${a.name}</div>
      </div>
      
      <!-- Info Table - Glass Card -->
      <div class="glass-card" style="margin: 0 16px 20px; border-radius: 16px; overflow: hidden;">
        <div class="info-row">
          <span class="info-label">Начало</span>
          <span class="info-value">${formatDate(a.startAt)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Раунд</span>
          <span class="info-value">${a.currentRound} из ${a.totalRounds}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Количество</span>
          <span class="info-value">${formatNumber(a.totalItems)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Осталось</span>
          <span class="info-value">${formatNumber(a.totalItems - a.distributedItems)}</span>
        </div>
      </div>
      
      ${a.status === 'active' && a.activeRound ? `
        <!-- Slider Section -->
        <div style="padding: 0 16px;">
          <!-- Bid Badge Container -->
          <div class="bid-badge-container" id="bidBadgeContainer">
            <div class="bid-badge ${isInTop ? 'in-top' : 'not-in-top'}" id="bidBadge">
              <span style="color: ${isInTop ? 'white' : '#ffd60a'};">⭐</span>
              <span class="bid-badge-value" id="bidBadgeValue">${formatNumber(currentValue)}</span>
              <div class="bid-badge-arrow"></div>
            </div>
          </div>
          
          <!-- Slider Track -->
          <div class="slider-container">
            <div class="slider-track-bg">
              <div class="slider-progress slider-track" id="sliderProgress" style="width: ${((currentValue - minBid) / (maxBid - minBid)) * 100}%;"></div>
              <div class="top-indicator ${isInTop ? 'active' : 'inactive'}" id="topIndicator">
                ${isInTop ? '✓' : ''} ТОП-${winnersCount}
              </div>
            </div>
            <input type="range" class="slider-range-input" id="bidSlider" 
              min="${minBid}" max="${maxBid}" value="${currentValue}">
            <div class="slider-thumb" id="sliderThumb"></div>
            <button class="slider-plus-btn" onclick="incrementBid()">+</button>
          </div>
          
          <!-- Hint for TOP (always present, visibility controlled by JS) -->
          <div class="top-hint" id="topHint" style="${isInTop ? 'display: none;' : ''}">
            До ТОП-${winnersCount}: <span class="top-hint-amount">+${formatNumber(minBidForWin - currentValue > 0 ? minBidForWin - currentValue : 0)} ⭐</span>
          </div>
        </div>
        
        <!-- Stat Cards -->
        <div class="stat-cards" style="padding: 0 16px; margin-top: 20px;">
          <div class="stat-card glass-card">
            <div class="stat-card-value">
              <span style="color: #ff9500;">⭐</span>
              ${formatNumber(minBid)}
            </div>
            <div class="stat-card-label">минимум</div>
          </div>
          <div class="stat-card glass-card">
            <div class="stat-card-value timer-value">${formatTimer(remaining)}</div>
            <div class="stat-card-label">до нового раунда</div>
          </div>
          <div class="stat-card glass-card">
            <div class="stat-card-value">
              <span>🎁</span>
              ${formatNumber(a.totalItems - a.distributedItems)}
            </div>
            <div class="stat-card-label">осталось</div>
          </div>
        </div>
        
        <!-- My Bid Row -->
        ${myBid ? `
          <div style="padding: 0 16px; margin-top: 24px;">
            <div class="section-title">Ваша текущая ставка</div>
            <div class="user-row" style="padding: 8px 0;">
              <div class="user-row-left">
                <div class="user-rank ${myBid.rank === 1 ? 'gold' : myBid.rank === 2 ? 'silver' : myBid.rank === 3 ? 'bronze' : 'normal'}">
                  ${myBid.rank}
                </div>
                <div class="user-avatar">${state.user?.username?.charAt(0)?.toUpperCase() || 'U'}</div>
                <span class="user-name">${state.user?.username || 'Вы'}</span>
              </div>
              <div class="user-bid">
                <span class="user-bid-star">⭐</span>
                ${formatNumber(myBid.amount)}
              </div>
            </div>
          </div>
        ` : ''}
        
        <!-- Top 3 Leaderboard -->
        ${leaderboard && leaderboard.length > 0 ? `
          <div style="padding: 0 16px; margin-top: 24px;">
            <div class="section-title">Топ-3 ставки</div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${leaderboard.slice(0, 3).map(l => `
                <div class="user-row">
                  <div class="user-row-left">
                    <div class="user-rank ${l.rank === 1 ? 'gold' : l.rank === 2 ? 'silver' : l.rank === 3 ? 'bronze' : 'normal'}">
                      ${l.rank}
                    </div>
                    <div class="user-avatar">${l.username?.charAt(0)?.toUpperCase() || '?'}</div>
                    <span class="user-name">${l.username}</span>
                  </div>
                  <div class="user-bid">
                    <span class="user-bid-star">⭐</span>
                    ${formatNumber(l.amount)}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        <!-- Footer Action Button -->
        <div class="footer-action">
          <button class="btn btn-blue" onclick="placeBid()">
            Сделать ставку ⭐ <span id="bidButtonValue">${formatNumber(currentValue)}</span>
          </button>
        </div>
      ` : `
        <!-- Pending/Completed state -->
        <div style="padding: 20px; text-align: center;">
          <span class="auction-detail-status status-${a.status}">${getStatusLabel(a.status)}</span>
          <p style="margin-top: 16px; color: var(--tg-hint);">
            ${a.status === 'pending' ? 'Аукцион скоро начнётся' : 'Аукцион завершён'}
          </p>
        </div>
      `}
    </div>
  `;

  // Setup slider event listeners
  if (a.status === 'active' && a.activeRound) {
    setupSlider(minBid, maxBid, minBidForWin, winnersCount);
  }

  // Restore scroll position after render
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY);
  });
}

function setupSlider(minBid, maxBid, minBidForWin, winnersCount) {
  const slider = $('#bidSlider');
  const badge = $('#bidBadge');
  const badgeValue = $('#bidBadgeValue');
  const buttonValue = $('#bidButtonValue');
  const progress = $('#sliderProgress');
  const thumb = $('#sliderThumb');
  const topIndicator = $('#topIndicator');
  const container = $('#bidBadgeContainer');

  if (!slider) return;

  const trackBg = $('#sliderProgress')?.parentElement;

  const updateSlider = () => {
    const value = parseInt(slider.value, 10);
    const percentage = ((value - minBid) / (maxBid - minBid)) * 100;
    const isInTop = value >= minBidForWin;

    // Update progress bar and color (gray when not in top, gradient when in top)
    progress.style.width = `${Math.max(percentage, 2)}%`;
    if (isInTop) {
      progress.classList.remove('not-in-top');
    } else {
      progress.classList.add('not-in-top');
    }

    // Calculate position based on track width
    const trackWidth = trackBg ? trackBg.offsetWidth : slider.offsetWidth;
    const thumbPos = (percentage / 100) * (trackWidth - 40) + 20; // Account for thumb width

    // Update thumb position
    thumb.style.left = `${thumbPos}px`;

    // Update badge position and value
    badge.style.left = `${thumbPos}px`;
    badgeValue.textContent = formatNumber(value);
    buttonValue.textContent = formatNumber(value);

    // Update badge color
    if (isInTop) {
      badge.classList.remove('not-in-top');
      badge.classList.add('in-top');
    } else {
      badge.classList.remove('in-top');
      badge.classList.add('not-in-top');
    }

    // Update TOP indicator
    topIndicator.className = `top-indicator ${isInTop ? 'active' : 'inactive'}`;
    topIndicator.innerHTML = `${isInTop ? '✓ ' : ''}ТОП-${winnersCount}`;

    // Update top-hint text
    const topHint = document.querySelector('.top-hint');
    if (topHint) {
      if (isInTop) {
        topHint.style.display = 'none';
      } else {
        topHint.style.display = 'block';
        const diff = minBidForWin - value;
        topHint.innerHTML = `До ТОП-${winnersCount}: <span class="top-hint-amount">+${formatNumber(diff > 0 ? diff : 0)} ⭐</span>`;
      }
    }

    // Store current value and interaction time in state
    state.currentBidValue = value;
    state.lastSliderInteraction = Date.now();
  };

  slider.addEventListener('input', updateSlider);

  // Initial update
  setTimeout(updateSlider, 50);
}

function incrementBid() {
  const slider = $('#bidSlider');
  if (slider) {
    const currentValue = parseInt(slider.value, 10);
    slider.value = Math.min(currentValue + 1000, 200000);
    slider.dispatchEvent(new Event('input'));
  }
}

async function placeBid() {
  // Get amount from slider or state
  const slider = $('#bidSlider');
  const amount = slider ? parseInt(slider.value, 10) : (state.currentBidValue || 0);

  if (!amount || amount <= 0) {
    alert('Выберите сумму ставки');
    return;
  }

  try {
    await api(`/auctions/${state.currentAuction.id}/bid`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });

    // Force full re-render after placing bid to show new bid immediately
    await forceRefreshAuctionData();

    const user = await api('/users/me');
    state.user = user;
    renderUserInfo();
  } catch (err) {
    alert(err.message);
  }
}

async function createAuction(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  const firstRoundMinutes = parseInt(formData.get('firstRoundMinutes'), 10);
  const otherRoundMinutes = parseInt(formData.get('otherRoundMinutes'), 10);
  const winnersPerRound = parseInt(formData.get('winnersPerRound'), 10);
  const minBid = parseInt(formData.get('minBid'), 10);


  const startNowCheckbox = document.getElementById('startNow');
  const startNow = startNowCheckbox && startNowCheckbox.checked;


  let startAt;
  if (startNow) {
    startAt = new Date(Date.now() + 5000).toISOString();
  } else {
    const dateValue = formData.get('startAt');
    if (!dateValue) {
      alert('Выберите дату старта или поставьте галочку "Запустить сразу"');
      return;
    }
    startAt = new Date(dateValue).toISOString();
  }

  const payload = {
    name: formData.get('name'),
    description: formData.get('description'),
    totalItems: parseInt(formData.get('totalItems'), 10),
    totalRounds: parseInt(formData.get('totalRounds'), 10),
    startAt: startAt,
  };

  if (winnersPerRound > 0) {
    payload.winnersPerRound = winnersPerRound;
  }
  if (minBid > 0) {
    payload.minBid = minBid;
  }
  if (firstRoundMinutes > 0) {
    payload.firstRoundDuration = firstRoundMinutes * 60 * 1000;
  }
  if (otherRoundMinutes > 0) {
    payload.otherRoundDuration = otherRoundMinutes * 60 * 1000;
  }

  try {
    await api('/auctions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    form.reset();
    alert(startNow ? 'Аукцион создан и запустится через 5 секунд!' : 'Аукцион создан');
    showPage('auctions');
    loadAuctions();
  } catch (err) {
    alert(err.message);
  }
}

async function loadWins() {
  try {
    const wins = await api('/users/me/wins');
    renderWins(wins);
  } catch (err) {
    console.error(err);
  }
}

function renderWins(wins) {
  const container = $('#winsList');

  if (!wins || wins.length === 0) {
    container.innerHTML = '<div class="empty-state">У вас пока нет выигранных подарков</div>';
    return;
  }

  container.innerHTML = wins.map(w => `
        <div class="win-card">
            <div class="win-icon">🎁</div>
            <div class="win-info">
                <div class="win-number">Подарок #${w.itemNumber}</div>
                <div class="win-details">Раунд ${w.wonInRound} • ⭐ ${formatNumber(w.amount)}</div>
            </div>
        </div>
    `).join('');
}

function init() {
  // Initialize WebSocket for real-time updates
  initWebSocket();

  const savedUser = localStorage.getItem('user');
  if (savedUser) {
    state.user = JSON.parse(savedUser);
    renderUserInfo();
    showPage('auctions');
    loadAuctions();

    // Fetch real balance from API
    refreshUserBalance();
  } else {
    showPage('login');
  }
}

// Refresh user balance from API
async function refreshUserBalance() {
  try {
    const user = await api('/users/me');
    state.user = user;
    localStorage.setItem('user', JSON.stringify(user));
    renderUserInfo();
  } catch (err) {
    // If user not found, clear localStorage and show login
    localStorage.removeItem('user');
    state.user = null;
    showPage('login');
  }
}

function setupEventListeners() {
  $('#loginBtn').addEventListener('click', login);
  $('#usernameInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') login();
  });

  $('#backBtn').addEventListener('click', () => {
    stopAuctionRefresh();
    showPage('auctions');
    loadAuctions();
  });

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentTab = tab.dataset.tab;
      renderAuctions();
    });
  });

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopAuctionRefresh();
      showPage(btn.dataset.page);
      if (btn.dataset.page === 'auctions') {
        loadAuctions();
      } else if (btn.dataset.page === 'wins') {
        loadWins();
      }
    });
  });

  $('#createAuctionForm').addEventListener('submit', createAuction);

  // Toggle date picker visibility based on "Start Now" checkbox
  const startNowCheckbox = $('#startNow');
  const startAtWrapper = $('#startAtWrapper');
  if (startNowCheckbox && startAtWrapper) {
    startNowCheckbox.addEventListener('change', () => {
      if (startNowCheckbox.checked) {
        startAtWrapper.style.display = 'none';
      } else {
        startAtWrapper.style.display = 'block';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupEventListeners();
});
