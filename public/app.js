// ================== CONFIG ==================
const AVATARS = ['😎','🤠','👻','🦊','🐱','🐶','🦁','🐸','🐵','🦄','🐲','🎃'];
const ROLE_ICONS = {
  mafia: '🔪',
  villager: '🧑‍🌾',
  doctor: '💉',
  detective: '🔍',
  veteran: '🎖️',
  sheriff: '🤠',
  medium: '🔮'
};
const ROLE_DESCS = {
  mafia: 'กำจัดชาวบ้านในตอนกลางคืน',
  villager: 'ตามหามาเฟียและโหวตกำจัดในตอนกลางวัน',
  doctor: 'เลือก 1 คนเพื่อป้องกันการตายในตอนกลางคืน',
  jester: 'หลอกให้ชาวบ้านโหวตประหารตัวเองเพื่อชนะ',
  veteran: 'ป้องกันตัวในตอนกลางคืน ทุกคนที่เข้ามาหาคุณจะตายทั้งหมด!',
  sheriff: 'ยิงคนในตอนกลางวันได้ 1 ครั้ง (ถ้ายิงคนดี ตัวเองจะตายด้วย)',
  medium: 'สามารถอ่านข้อความและพูดคุยกับคนตายได้ในตอนกลางคืน'
};
const FACTION_COLORS = { good: '#2ecc71', evil: '#e74c3c', special: '#f39c12' };

// ================== STATE ==================
let socket;
let selectedAvatar = 0;
let gameState = null;
let timerInterval = null;
let currentVote = null;
let soundEnabled = true;
let lastDeathSoundRound = 0;
let lastPhase = null;
let audioCtx = null;

// ================== DOM ELEMENTS ==================
const $ = id => document.getElementById(id);

// ================== SOUND ==================
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.15) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

function playNightSound() { playTone(220, 1.2, 'sine', 0.1); setTimeout(() => playTone(185, 1.0, 'sine', 0.08), 300); }
function playDaySound() { playTone(523, 0.15, 'square', 0.1); setTimeout(() => playTone(659, 0.15, 'square', 0.1), 150); setTimeout(() => playTone(784, 0.3, 'square', 0.1), 300); }
function playVoteSound() { playTone(440, 0.1, 'square', 0.1); }
function playKillSound() { playTone(150, 0.8, 'sawtooth', 0.08); }
function playWinSound() { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f, 0.3, 'square', 0.12), i * 200)); }

// ================== INIT ==================
function init() {
  createStars();
  createAvatarSelect();
  connectSocket();
  bindEvents();
}

function createStars() {
  const container = $('stars');
  for (let i = 0; i < 80; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (2 + Math.random() * 3) + 's';
    star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
    container.appendChild(star);
  }
}

function createAvatarSelect() {
  const container = $('avatarSelect');
  AVATARS.forEach((emoji, i) => {
    const div = document.createElement('div');
    div.className = 'avatar-option' + (i === 0 ? ' selected' : '');
    div.textContent = emoji;
    div.onclick = () => {
      container.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedAvatar = i;
    };
    container.appendChild(div);
  });
}

// ================== SOCKET ==================
function connectSocket() {
  socket = io({ transports: ['websocket'] });

  socket.on('roomCreated', ({ roomCode }) => {
    showScreen('gameScreen');
    $('roomCodeDisplay').textContent = roomCode;
  });

  socket.on('roomJoined', ({ roomCode }) => {
    showScreen('gameScreen');
    $('roomCodeDisplay').textContent = roomCode;
  });

  socket.on('gameState', (state) => {
    gameState = state;
    renderGameState(state);
  });

  socket.on('roleAssigned', (data) => {
    showRoleReveal(data);
  });

  socket.on('detectiveResult', ({ targetName, isMafia }) => {
    const text = `${targetName} ${isMafia ? 'เป็นมาเฟีย! 🔴' : 'ไม่ใช่มาเฟีย ✅'}`;
    const color = isMafia ? '#f44336' : '#4caf50';
    showToast(`🔍 ผลสืบสวน: ${text}`, color);
    
    appendChat({
      senderName: '🔍 สมุดพกนักสืบ',
      message: text,
      isSystem: true,
      color: color
    });
  });

  socket.on('chatMessage', (msg) => {
    appendChat(msg);
  });

  socket.on('gameOver', (data) => {
    showGameOver(data);
  });

  socket.on('error', ({ message }) => {
    showError(message);
  });
}

// ================== EVENTS ==================
function bindEvents() {
  $('createRoomBtn').onclick = () => {
    const name = $('playerNameInput').value.trim();
    if (!name) { showError('กรุณาใส่ชื่อ'); return; }
    socket.emit('createRoom', { 
      playerName: name, 
      avatar: selectedAvatar,
      veteran: $('settingVeteran') ? $('settingVeteran').checked : false,
      sheriff: $('settingSheriff') ? $('settingSheriff').checked : false
    });
  };

  $('joinRoomBtn').onclick = () => {
    const name = $('playerNameInput').value.trim();
    const code = $('roomCodeInput').value.trim().toUpperCase();
    if (!name) { showError('กรุณาใส่ชื่อ'); return; }
    if (!code || code.length < 4) { showError('กรุณาใส่รหัสห้อง'); return; }
    socket.emit('joinRoom', { roomCode: code, playerName: name, avatar: selectedAvatar });
  };

  $('startGameBtn').onclick = () => {
    const customSettings = {
      useCustom: $('useCustomRoles').checked,
      mafiaCount: parseInt($('settingMafia').value) || 1,
      doctor: $('settingDoctor').checked,
      detective: $('settingDetective').checked,
      jester: $('settingJester') ? $('settingJester').checked : false,
      veteran: $('settingVeteran') ? $('settingVeteran').checked : false,
      sheriff: $('settingSheriff') ? $('settingSheriff').checked : false,
      medium: $('settingMedium') ? $('settingMedium').checked : false,
      timeDiscuss: $('timeDiscuss') ? $('timeDiscuss').value : 2,
      timeVote: $('timeVote') ? $('timeVote').value : 1,
      timeNight: $('timeNight') ? $('timeNight').value : 1
    };
    socket.emit('startGame', customSettings);
  };

  $('skipVoteBtn').onclick = () => {
    socket.emit('dayVote', { targetId: 'skip' });
    currentVote = 'skip';
  };

  $('confirmDayVoteBtn').onclick = () => {
    socket.emit('confirmDayVote');
  };

  $('skipDiscussBtn').onclick = () => {
    socket.emit('skipDiscuss');
  };

  $('confirmNightBtn').onclick = () => {
    socket.emit('confirmNight');
  };

  if ($('veteranAlertBtn')) {
    $('veteranAlertBtn').onclick = () => {
      socket.emit('veteranAlert');
    };
  }

  $('hostSettingsToggle').onclick = () => {
    const content = $('hostSettingsContent');
    const icon = $('hostSettingsIcon');
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.textContent = '▲';
    } else {
      content.style.display = 'none';
      icon.textContent = '▼';
    }
  };



  $('roleOkBtn').onclick = () => {
    $('roleReveal').classList.add('hidden');
  };

  $('playAgainBtn').onclick = () => {
    $('gameOverOverlay').classList.add('hidden');
    socket.emit('returnToLobby');
  };

  if ($('leaveRoomBtn')) {
    $('leaveRoomBtn').onclick = () => {
      window.location.reload();
    };
  }

  // Rules modal
  $('rulesBtn').onclick = () => $('rulesModal').classList.remove('hidden');
  $('closeRulesBtn').onclick = () => $('rulesModal').classList.add('hidden');
  $('rulesModal').onclick = (e) => { if (e.target === $('rulesModal')) $('rulesModal').classList.add('hidden'); };

  // Sound toggle
  $('soundBtn').onclick = () => {
    soundEnabled = !soundEnabled;
    $('soundBtn').textContent = soundEnabled ? '🔊' : '🔇';
    if (soundEnabled) playTone(440, 0.1, 'sine', 0.1);
  };

  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  $('chatSendBtn').onclick = sendChat;

  // Enter key on inputs
  $('playerNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('createRoomBtn').click();
  });
  $('roomCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('joinRoomBtn').click();
  });
}

function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chatMessage', { message: msg });
  input.value = '';
}

// ================== RENDER ==================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function renderGameState(state) {
  const isDay = ['day_announce','day_discuss','day_vote','day_result'].includes(state.phase);
  document.body.classList.toggle('day-phase', isDay);

  // Phase change sounds
  if (lastPhase !== state.phase) {
    if (state.phase === 'night_vote') playNightSound();
    else if (state.phase === 'day_announce') { playDaySound(); if (state.lastKilled) playKillSound(); }
    else if (state.phase === 'day_vote') playVoteSound();
    else if (state.phase === 'game_over') playWinSound();
    lastPhase = state.phase;
    currentVote = null;
  }
  // Starting Countdown
  if (state.phase === 'starting') {
    $('countdownOverlay').classList.remove('hidden');
    $('countdownText').textContent = state.timer || 3;
    return; // Stop rendering other game elements during countdown
  } else {
    $('countdownOverlay').classList.add('hidden');
  }

  const isLobby = state.phase === 'lobby';
  const isGameOver = state.phase === 'game_over';

  // Host Settings visibility
  if (isLobby || isGameOver) {
    $('hostSettings').classList.toggle('hidden', !state.isHost);
  } else {
    $('hostSettings').classList.add('hidden');
  }

  $('startGameBtn').style.display = (state.isHost && (isLobby || isGameOver)) ? 'block' : 'none';
  $('startGameBtn').disabled = state.players.length < 4;
  $('startGameBtn').textContent = isGameOver ? '🔄 เล่นอีกครั้ง' : '🎮 เริ่มเกม';

  // My role badge
  if (state.myRole && state.phase !== 'lobby') {
    $('myRoleBadge').classList.remove('hidden', 'faction-good', 'faction-evil', 'faction-special');
    $('myRoleBadge').classList.add('faction-' + state.myFaction);
    $('myRoleIcon').textContent = ROLE_ICONS[state.myRole] || '🎭';
    $('myRoleText').textContent = `คุณคือ ${getRoleNameTh(state.myRole)} (${state.myAlive ? 'มีชีวิต' : '💀 ตายแล้ว'})`;
  } else {
    $('myRoleBadge').classList.add('hidden');
  }

  // Phase banner
  renderPhaseBanner(state);

  // Announcement
  renderAnnouncement(state);

  // Roles in Play Banner
  if (state.phase !== 'lobby' && state.rolesInPlay && state.rolesInPlay.length > 0) {
    const counts = {};
    state.rolesInPlay.forEach(r => counts[r] = (counts[r]||0)+1);
    const roleTexts = Object.entries(counts).map(([r, c]) => `${ROLE_ICONS[r] || ''} ${getRoleNameTh(r)} x${c}`).join(' &nbsp;|&nbsp; ');
    $('rolesInPlayBanner').innerHTML = `<strong>บทบาทในรอบนี้:</strong><br>${roleTexts}`;
    $('rolesInPlayBanner').classList.remove('hidden');
  } else {
    if ($('rolesInPlayBanner')) $('rolesInPlayBanner').classList.add('hidden');
  }

  // Vote section & skip button
  const canVoteDay = state.phase === 'day_vote' && state.myAlive && !state.hasConfirmedDay;
  const canVoteNight = state.phase === 'night_vote' && state.myAlive;
  const showVote = canVoteDay || canVoteNight;
  
  $('voteSection').classList.toggle('hidden', !showVote);
  
  $('skipVoteBtn').classList.toggle('hidden', state.phase !== 'day_vote');
  $('skipVoteBtn').disabled = state.hasConfirmedDay;
  if (state.phase === 'day_vote') {
    $('skipVoteBtn').textContent = `⏭️ ข้ามโหวต (ไม่กำจัดใคร) - ${state.skipVoteCount || 0} เสียง`;
  }

  // Day Confirm
  const canConfirmDay = state.phase === 'day_vote' && state.myAlive && state.hasVoted;
  $('confirmDayVoteBtn').classList.toggle('hidden', state.phase !== 'day_vote');
  $('confirmDayVoteBtn').disabled = !canConfirmDay || state.hasConfirmedDay;
  if (state.phase === 'day_vote') {
    const aliveCount = state.players.filter(p => p.alive).length;
    $('confirmDayVoteBtn').textContent = state.hasConfirmedDay ? `✅ ยืนยันแล้ว (${state.dayConfirmCount || 0}/${aliveCount})` : `✅ ยืนยันการโหวต (${state.dayConfirmCount || 0}/${aliveCount})`;
    $('confirmDayVoteBtn').style.opacity = state.hasConfirmedDay ? '0.6' : '1';
  }

  // Skip Discuss
  const canSkipDiscuss = state.phase === 'day_discuss' && state.myAlive;
  $('skipDiscussBtn').classList.toggle('hidden', !canSkipDiscuss || state.hasVotedSkipDiscuss);
  if (canSkipDiscuss && !state.hasVotedSkipDiscuss) {
    const aliveCount = state.players.filter(p => p.alive).length;
    const required = Math.ceil(aliveCount / 2);
    $('skipDiscussBtn').textContent = `⏩ โหวตข้ามเวลาพูดคุย (${state.skipDiscussVoteCount || 0}/${required})`;
  }

  // Night Confirm
  const canConfirmNight = state.phase === 'night_vote' && state.myAlive;
  $('confirmNightBtn').classList.toggle('hidden', !canConfirmNight || state.hasConfirmedNight);
  if (canConfirmNight && !state.hasConfirmedNight) {
    $('confirmNightBtn').textContent = `✅ ยืนยันการกระทำ (${state.nightConfirmCount || 0}/${state.nightActiveCount || 1})`;
  }

  if (state.phase === 'night_vote') {
    if (state.myRole === 'mafia') {
      $('voteTitle').textContent = '🔪 เลือกเหยื่อที่จะฆ่า';
    } else if (state.myRole === 'doctor' && !state.doctorUsed) {
      $('voteTitle').textContent = '💉 เลือกคนที่จะช่วยชีวิต';
    } else if (state.myRole === 'detective' && !state.detectiveUsed) {
      $('voteTitle').textContent = '🔍 เลือกคนที่จะตรวจสอบ';
    } else if (state.myRole === 'veteran') {
      $('voteTitle').textContent = '🎖️ ทหารผ่านศึก: ป้องกันตัวหรือไม่?';
      // Keeping voteSection visible for Veteran to allow toggling or viewing players
    } else {
      $('voteSection').classList.add('hidden');
    }
  } else if (state.phase === 'day_vote') {
    $('voteTitle').textContent = '🗳️ โหวตกำจัดใครออกจากหมู่บ้าน';
  }

  // Veteran Alert Button
  if (state.myRole === 'veteran' && state.phase === 'night_vote' && state.myAlive && !state.veteranUsed) {
    $('veteranAlertBtn').classList.remove('hidden');
    
    if (state.veteranAlert) {
      $('veteranAlertBtn').textContent = '🛡️ กำลังป้องกันตัว! (คลิกเพื่อยกเลิก)';
      $('veteranAlertBtn').style.background = '#4caf50';
      $('veteranAlertBtn').style.opacity = '1';
      $('veteranAlertBtn').style.border = '2px solid white';
    } else {
      $('veteranAlertBtn').textContent = '🛡️ เปิดการป้องกันตัว (ใช้ได้ 1 ครั้ง/เกม)';
      $('veteranAlertBtn').style.background = '#e91e63';
      $('veteranAlertBtn').style.opacity = '0.8';
      $('veteranAlertBtn').style.border = 'none';
    }
    
    $('veteranAlertBtn').disabled = state.hasConfirmedNight;
  } else {
    $('veteranAlertBtn').classList.add('hidden');
  }

  // Player grid
  renderPlayers(state);

  // Chat
  const canChat = isLobby || isGameOver || 
    (state.phase === 'day_discuss' && state.myAlive) ||
    (state.phase === 'day_vote' && state.myAlive) ||
    (state.phase === 'night_vote' && state.myRole === 'mafia' && state.myAlive);
  
  $('chatInput').disabled = !canChat;
  $('chatSendBtn').disabled = !canChat;
  
  if (state.phase === 'night_vote' && state.myRole === 'mafia') {
    $('chatLabel').textContent = '🔴 แชทมาเฟีย';
  } else {
    $('chatLabel').textContent = 'ทั้งหมด';
  }

  // Game log
  renderGameLog(state.gameLog);

  // Timer
  updateTimer(state);
}

function renderPhaseBanner(state) {
  const banner = $('phaseBanner');
  const icon = $('phaseIcon');
  const title = $('phaseTitle');
  const sub = $('phaseSubtitle');

  switch (state.phase) {
    case 'lobby':
      icon.textContent = '🏠';
      title.textContent = `ห้องรอ (${state.players.length}/10)`;
      sub.textContent = state.players.length < 4 ? `ต้องการอีก ${4 - state.players.length} คน` : 'พร้อมเริ่มเกม!';
      break;
    case 'night':
    case 'night_vote':
      icon.textContent = '🌙';
      title.textContent = `คืนที่ ${state.round}`;
      if (state.myRole === 'mafia' && state.myAlive) {
        sub.textContent = '🔪 เลือกเหยื่อ...';
      } else if (state.myRole === 'doctor' && state.myAlive) {
        sub.textContent = '💉 เลือกคนที่จะช่วยชีวิต...';
      } else if (state.myRole === 'detective' && state.myAlive) {
        sub.textContent = '🔍 เลือกคนที่จะตรวจสอบ...';
      } else {
        sub.textContent = 'ทุกคนหลับ... มาเฟียกำลังเลือกเหยื่อ';
      }
      break;
    case 'day_announce':
      icon.textContent = '☀️';
      title.textContent = `เช้าวันที่ ${state.round}`;
      sub.textContent = 'ผลจากเมื่อคืน...';
      break;
    case 'day_discuss':
      icon.textContent = '💬';
      title.textContent = 'เวลาพูดคุย';
      sub.textContent = 'หาว่าใครคือมาเฟีย!';
      break;
    case 'day_vote':
      icon.textContent = '🗳️';
      title.textContent = 'เวลาโหวต';
      sub.textContent = `โหวตแล้ว ${state.dayVoteCount} คน`;
      break;
    case 'day_result':
      icon.textContent = '⚖️';
      title.textContent = 'ผลการโหวต';
      sub.textContent = '';
      break;
    case 'game_over':
      icon.textContent = '🏆';
      title.textContent = 'จบเกม!';
      sub.textContent = '';
      break;
  }
}

function renderAnnouncement(state) {
  const area = $('announcementArea');
  
  if (state.phase === 'day_announce' && state.killedPlayers && state.killedPlayers.length > 0) {
    if (lastDeathSoundRound !== state.round) {
      playDeathSound();
      lastDeathSoundRound = state.round;
    }
    
    area.classList.remove('hidden');
    area.innerHTML = state.killedPlayers.map(k => `
      <div class="announcement" style="margin-bottom:10px;">
        <div class="icon">💀</div>
        <div class="title">${escapeHtml(k.name)} ถูกสังหาร!</div>
        <div class="detail">บทบาท: ${ROLE_ICONS[k.role] || '❓'} ${getRoleNameTh(k.role)}</div>
      </div>
    `).join('');
  } else if (state.phase === 'day_announce' && (!state.killedPlayers || state.killedPlayers.length === 0)) {
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="announcement">
        <div class="icon">✨</div>
        <div class="title">ไม่มีใครเสียชีวิตเมื่อคืน!</div>
        <div class="detail">หมอช่วยชีวิตไว้ได้ หรือมีการป้องกันสำเร็จ</div>
      </div>
    `;
  } else if (state.phase === 'day_result' && state.lastEliminated) {
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="announcement">
        <div class="icon">⚖️</div>
        <div class="title">${state.lastEliminated.name} ถูกกำจัดออกจากหมู่บ้าน!</div>
        <div class="detail">บทบาท: ${ROLE_ICONS[state.lastEliminated.role] || '❓'} ${getRoleNameTh(state.lastEliminated.role)}</div>
      </div>
    `;
  } else if (state.phase === 'day_result' && !state.lastEliminated) {
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="announcement">
        <div class="icon">🤝</div>
        <div class="title">ไม่มีใครถูกกำจัด</div>
        <div class="detail">คะแนนโหวตไม่เพียงพอ หรือผลเสมอกัน</div>
      </div>
    `;
  } else {
    area.classList.add('hidden');
    area.innerHTML = '';
  }
}

function renderPlayers(state) {
  const grid = $('playerGrid');
  grid.innerHTML = '';
  
  const canVote = getCanVote(state);

  state.players.forEach(p => {
    const card = document.createElement('div');
    let classes = 'player-card';
    if (!p.alive) classes += ' dead';
    if (p.isMafiaTeam && state.myRole === 'mafia') classes += ' mafia-team';
    
    const isVotable = canVote && p.alive && p.id !== socket.id;
    if (isVotable) classes += ' votable';
    if (currentVote === p.id) classes += ' voted pulse';
    
    card.className = classes;

    let roleBadge = '';
    if (p.role) {
      const factionClass = p.faction === 'good' ? 'role-good' : p.faction === 'evil' ? 'role-evil' : 'role-special';
      roleBadge = `<div class="role-badge ${factionClass}">${ROLE_ICONS[p.role] || ''} ${getRoleNameTh(p.role)}</div>`;
    }

    const hostBadge = p.isHost ? '<span class="host-badge">👑</span>' : '';
    const voteCount = (state.dayVoteCounts && state.dayVoteCounts[p.id]) ? state.dayVoteCounts[p.id] : 0;
    const voteCountBadge = (state.phase === 'day_vote' && voteCount > 0) ? `<div class="vote-count">${voteCount}</div>` : '';
    
    const mafiaVoteCount = (state.mafiaVoteCounts && state.mafiaVoteCounts[p.id]) ? state.mafiaVoteCounts[p.id] : 0;
    const mafiaVoteBadge = (state.phase === 'night_vote' && state.myRole === 'mafia' && mafiaVoteCount > 0) ? `<div class="vote-count" style="background:#e74c3c; border-color:#fff;">🔪 ${mafiaVoteCount}</div>` : '';

    card.innerHTML = `
      ${hostBadge}
      ${voteCountBadge}
      ${mafiaVoteBadge}
      <div class="avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="name">${escapeHtml(p.name)}</div>
      ${roleBadge}
    `;

    // Sheriff Shoot Button
    if (state.myRole === 'sheriff' && state.myAlive && !state.sheriffUsed && ['day_discuss', 'day_vote'].includes(state.phase) && p.alive && p.id !== socket.id) {
      const shootBtn = document.createElement('button');
      shootBtn.className = 'btn';
      shootBtn.style.cssText = 'background: #ff9800; color: white; padding: 4px 8px; font-size: 0.8rem; margin-top: 5px; width: 100%; border:none; border-radius:4px; cursor:pointer;';
      shootBtn.textContent = '🔫 ยิง';
      shootBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`คุณแน่ใจหรือไม่ว่าจะยิง ${p.name}? (ใช้ได้ครั้งเดียว)`)) {
          socket.emit('sheriffShoot', { targetId: p.id });
        }
      };
      card.appendChild(shootBtn);
    }

    if (isVotable) {
      card.onclick = () => handleVote(state, p.id);
    }

    grid.appendChild(card);
  });
}

function getCanVote(state) {
  if (!state.myAlive) return false;
  if (state.phase === 'day_vote' && !state.hasConfirmedDay) return true;
  if (state.phase === 'night_vote' && !state.hasConfirmedNight) return true;
  if (state.myRole === 'sheriff' && !state.sheriffUsed && ['day_discuss', 'day_vote'].includes(state.phase)) return true;
  return false;
}

function handleVote(state, targetId) {
  if (state.phase === 'day_vote') {
    socket.emit('dayVote', { targetId });
    currentVote = targetId;
  } else if (state.phase === 'night_vote') {
    if (state.myRole === 'mafia') {
      socket.emit('nightVote', { targetId });
      currentVote = targetId;
    } else if (state.myRole === 'doctor') {
      socket.emit('doctorSave', { targetId });
      currentVote = targetId;
    } else if (state.myRole === 'detective') {
      socket.emit('detectiveCheck', { targetId });
      currentVote = targetId;
    }
  }
}

function updateTimer(state) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  const hasTimer = state.timerEnd && ['night_vote','day_discuss','day_vote'].includes(state.phase);
  $('globalTimerContainer').style.display = hasTimer ? 'block' : 'none';

  if (!hasTimer) return;

  const totalDuration = state.timerDuration || (state.phase === 'day_discuss' ? 90 : 30);

  function tick() {
    const remaining = Math.max(0, Math.ceil((state.timerEnd - Date.now()) / 1000));
    
    // Format as MM:SS if more than 60 seconds, else just seconds
    if (remaining >= 60) {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      $('timerText').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    } else {
      $('timerText').textContent = remaining;
    }
    
    const pct = (remaining / totalDuration) * 100;
    $('timerFill').style.width = pct + '%';
    if (remaining <= 0 && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

function renderGameLog(logs) {
  const container = $('logEntries');
  container.innerHTML = '';
  if (!logs) return;
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = log.message;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function appendChat(msg) {
  const container = $('chatMessages');
  const div = document.createElement('div');
  
  let classes = 'chat-msg';
  if (msg.isMafiaChat) classes += ' mafia-chat';
  if (msg.isSystem) classes += ' system-chat';
  div.className = classes;
  
  if (msg.isSystem) {
    div.innerHTML = `<strong>${escapeHtml(msg.senderName)}:</strong> <span style="color:${msg.color || 'var(--text)'}">${escapeHtml(msg.message)}</span>`;
  } else {
    div.innerHTML = `<span class="sender">${escapeHtml(msg.senderName)}:</span> ${escapeHtml(msg.message)}`;
  }
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ================== OVERLAYS ==================
function showRoleReveal(data) {
  currentVote = null;
  $('roleIcon').textContent = ROLE_ICONS[data.role] || '🎭';
  $('roleName').textContent = data.roleName;
  $('roleDesc').textContent = ROLE_DESCS[data.role] || '';
  $('roleReveal').classList.remove('hidden');
  
  const card = document.querySelector('.role-reveal-card');
  card.style.borderColor = FACTION_COLORS[data.faction] || 'var(--accent2)';
}

function showGameOver(data) {
  $('winnerText').textContent = `${data.winnerName}ชนะ!`;
  $('winReason').textContent = data.reason;
  
  const container = $('resultPlayers');
  container.innerHTML = '';
  data.players.forEach(p => {
    const div = document.createElement('div');
    const bg = FACTION_COLORS[p.faction];
    div.className = 'result-player';
    div.style.background = `${bg}22`;
    div.style.color = bg;
    div.style.border = `1px solid ${bg}44`;
    div.innerHTML = `${p.alive ? '' : '💀'} ${escapeHtml(p.name)} — ${ROLE_ICONS[p.role]} ${p.roleName}`;
    container.appendChild(div);
  });

  $('playAgainBtn').style.display = 'inline-block';
  $('gameOverOverlay').classList.remove('hidden');
}

// ================== UTILS ==================
function showToast(message, borderColor) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'toast';
  div.style.borderColor = borderColor || 'var(--accent2)';
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

function showError(message) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'error-toast';
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function getRoleNameTh(role) {
  const names = { mafia:'มาเฟีย', villager:'ชาวบ้าน', doctor:'หมอ', detective:'นักสืบ', jester:'ตัวตลก', veteran:'ทหารผ่านศึก', sheriff:'นายอำเภอ', medium:'หมอผี' };
  return names[role] || role;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function playDeathSound() {
  if (!soundEnabled) return;
  if ('speechSynthesis' in window) {
    const msg = new SpeechSynthesisUtterance("จุ๊กกรู๊ โดนฆ่าแล้ว");
    msg.lang = 'th-TH';
    msg.rate = 1.1;
    msg.pitch = 1.2;
    window.speechSynthesis.speak(msg);
  }
}

// ================== START ==================
document.addEventListener('DOMContentLoaded', init);
