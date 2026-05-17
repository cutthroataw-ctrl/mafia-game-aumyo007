const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ================== GAME CONSTANTS ==================
const ROLES = {
  MAFIA: 'mafia',
  VILLAGER: 'villager',
  DOCTOR: 'doctor',
  DETECTIVE: 'detective',
  VETERAN: 'veteran',
  SHERIFF: 'sheriff',
  MEDIUM: 'medium',
  JESTER: 'jester',
  CURIOUS: 'curious'
};

const FACTIONS = {
  EVIL: 'evil',
  GOOD: 'good',
  SPECIAL: 'special'
};

const ROLE_FACTION = {
  [ROLES.MAFIA]: FACTIONS.EVIL,
  [ROLES.VILLAGER]: FACTIONS.GOOD,
  [ROLES.DOCTOR]: FACTIONS.GOOD,
  [ROLES.DETECTIVE]: FACTIONS.GOOD,
  [ROLES.JESTER]: FACTIONS.SPECIAL,
  [ROLES.CURIOUS]: FACTIONS.GOOD,
  [ROLES.VETERAN]: FACTIONS.GOOD,
  [ROLES.SHERIFF]: FACTIONS.GOOD,
  [ROLES.MEDIUM]: FACTIONS.GOOD
};

const ROLE_NAMES_TH = {
  [ROLES.MAFIA]: 'มาเฟีย',
  [ROLES.VILLAGER]: 'ชาวบ้านธรรมดา',
  [ROLES.DOCTOR]: 'บอดี้กาด',
  [ROLES.DETECTIVE]: 'นักสืบ',
  [ROLES.JESTER]: 'ตัวตลก',
  [ROLES.CURIOUS]: 'เด็กขี้สงสัย',
  [ROLES.VETERAN]: 'ทหารผ่านศึก',
  [ROLES.SHERIFF]: 'นายอำเภอ',
  [ROLES.MEDIUM]: 'หมอผี'
};

const FACTION_NAMES_TH = {
  [FACTIONS.EVIL]: 'ฝ่ายมาเฟีย',
  [FACTIONS.GOOD]: 'ฝ่ายดี',
  [FACTIONS.SPECIAL]: 'ฝ่ายพิเศษ'
};

const PHASES = {
  LOBBY: 'lobby',
  STARTING: 'starting',
  NIGHT: 'night',
  NIGHT_VOTE: 'night_vote',
  DAY_ANNOUNCE: 'day_announce',
  DAY_DISCUSS: 'day_discuss',
  DAY_VOTE: 'day_vote',
  DAY_RESULT: 'day_result',
  GAME_OVER: 'game_over'
};

// Role distribution based on player count
const ROLE_DISTRIBUTION = {
  4:  { [ROLES.MAFIA]: 1, [ROLES.VILLAGER]: 1, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1 },
  5:  { [ROLES.MAFIA]: 1, [ROLES.VILLAGER]: 2, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1 },
  6:  { [ROLES.MAFIA]: 2, [ROLES.VILLAGER]: 2, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1 },
  7:  { [ROLES.MAFIA]: 2, [ROLES.VILLAGER]: 3, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1 },
  8:  { [ROLES.MAFIA]: 2, [ROLES.VILLAGER]: 3, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1, [ROLES.JESTER]: 1 },
  9:  { [ROLES.MAFIA]: 3, [ROLES.VILLAGER]: 3, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1, [ROLES.JESTER]: 1 },
  10: { [ROLES.MAFIA]: 3, [ROLES.VILLAGER]: 3, [ROLES.DOCTOR]: 1, [ROLES.DETECTIVE]: 1, [ROLES.JESTER]: 2 }
};

const TIMERS = {
  NIGHT_VOTE: 30,      // 30 seconds for mafia to vote
  DAY_ANNOUNCE: 8,     // 8 seconds to show who died
  DAY_DISCUSS: 90,     // 90 seconds discussion
  DAY_VOTE: 30,        // 30 seconds to vote
  DAY_RESULT: 8        // 8 seconds to show result
};

// ================== GAME STATE ==================
const rooms = new Map();

function createRoom(hostId, hostName) {
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    hostId: hostId,
    players: new Map(),
    phase: PHASES.LOBBY,
    round: 0,
    nightVotes: new Map(),       // mafiaId -> targetId
    dayVotes: new Map(),         // playerId -> targetId
    doctorSave: null,            // who doctor chose to save
    detectiveCheck: null,        // who detective chose to check
    killedPlayers: [],
    lastEliminated: null,
    timer: null,
    timerEnd: null,
    jesterWin: false,
    gameLog: [],
    skipDiscussVotes: new Set(),
    nightConfirmations: new Set(),
    dayConfirmations: new Set(),
    veteranAlerts: new Set(),
    veteranUsed: new Set(),
    sheriffUsed: new Set(),
    customTimers: { ...TIMERS }
  };
  rooms.set(roomCode, room);
  return room;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function assignRoles(room, customSettings) {
  const playerCount = room.players.size;
  let roles = [];

  if (customSettings && customSettings.useCustom) {
    const mafiaCount = Math.max(1, parseInt(customSettings.mafiaCount) || 1);
    for (let i = 0; i < mafiaCount; i++) roles.push(ROLES.MAFIA);
    
    if (customSettings.randomGoodRoles) {
      const remainingCount = playerCount - roles.length;
      if (remainingCount > 0) {
        // Guaranteed at least one Detective
        roles.push(ROLES.DETECTIVE);
        
        for (let i = 1; i < remainingCount; i++) {
          const pool = [ROLES.DOCTOR, ROLES.DETECTIVE, ROLES.VETERAN, ROLES.SHERIFF, ROLES.MEDIUM, ROLES.CURIOUS];
          const randomRole = pool[Math.floor(Math.random() * pool.length)];
          roles.push(randomRole);
        }
      }
    } else {
      if (customSettings.doctor) roles.push(ROLES.DOCTOR);
      if (customSettings.detective) roles.push(ROLES.DETECTIVE);
      if (customSettings.jester) roles.push(ROLES.JESTER);
      if (customSettings.veteran) roles.push(ROLES.VETERAN);
      if (customSettings.sheriff) roles.push(ROLES.SHERIFF);
      if (customSettings.medium) roles.push(ROLES.MEDIUM);
      if (customSettings.curious) roles.push(ROLES.CURIOUS);

      const remaining = playerCount - roles.length;
      for (let i = 0; i < remaining; i++) {
        roles.push(ROLES.VILLAGER);
      }
    }
    
    if (roles.length > playerCount) {
      roles = roles.slice(0, playerCount);
    }
  } else {
    // Standard distribution (can be adjusted if needed)
    const dist = ROLE_DISTRIBUTION[playerCount];
    if (!dist) return false;

    for (const [role, count] of Object.entries(dist)) {
      for (let i = 0; i < count; i++) {
        roles.push(role);
      }
    }
  }

  const shuffledRoles = shuffleArray(roles);
  room.rolesInPlay = [...shuffledRoles];
  const playerIds = Array.from(room.players.keys());
  
  playerIds.forEach((id, index) => {
    const player = room.players.get(id);
    player.role = shuffledRoles[index];
    player.faction = ROLE_FACTION[shuffledRoles[index]];
    player.alive = true;
  });

  return true;
}

function getAlivePlayers(room) {
  return Array.from(room.players.values()).filter(p => p.alive);
}

function getAliveMafia(room) {
  return getAlivePlayers(room).filter(p => p.role === ROLES.MAFIA);
}

function getAliveGood(room) {
  return getAlivePlayers(room).filter(p => p.faction === FACTIONS.GOOD);
}

function checkWinCondition(room) {
  const aliveMafia = getAliveMafia(room);
  const aliveGood = getAliveGood(room);
  const aliveJester = getAlivePlayers(room).filter(p => p.role === ROLES.JESTER);

  if (room.jesterWin) {
    return { winner: FACTIONS.SPECIAL, reason: 'ตัวตลกถูกโหวตออก — ตัวตลกชนะ!' };
  }
  if (aliveMafia.length === 0) {
    return { winner: FACTIONS.GOOD, reason: 'มาเฟียถูกกำจัดหมดแล้ว — ฝ่ายดีชนะ!' };
  }
  if (aliveMafia.length >= (aliveGood.length + aliveJester.length)) {
    return { winner: FACTIONS.EVIL, reason: 'มาเฟียมีจำนวนเท่ากับหรือมากกว่าฝ่ายดีและตัวตลกรวมกัน — ฝ่ายร้ายชนะ!' };
  }
  return null;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
    room.timerEnd = null;
  }
}

function startTimer(room, seconds, callback) {
  clearRoomTimer(room);
  room.timerEnd = Date.now() + seconds * 1000;
  room.timer = setTimeout(() => {
    room.timer = null;
    room.timerEnd = null;
    callback();
  }, seconds * 1000);
}

function getPublicPlayerList(room, requesterId) {
  const players = [];
  for (const [id, p] of room.players) {
    const isRequester = id === requesterId;
    const requesterPlayer = room.players.get(requesterId);
    const isMafiaTeam = requesterPlayer && requesterPlayer.role === ROLES.MAFIA && p.role === ROLES.MAFIA;
    const showRole = isRequester || isMafiaTeam || (!p.alive && room.revealRoleOnDeath !== false) || room.phase === PHASES.GAME_OVER;
    
    players.push({
      id: id,
      name: p.name,
      alive: p.alive,
      role: showRole ? p.role : null,
      faction: showRole ? p.faction : null,
      isMafiaTeam: isMafiaTeam && room.phase !== PHASES.LOBBY,
      isHost: id === room.hostId,
      avatar: p.avatar
    });
  }
  return players;
}

function getDayVoteCounts(room) {
  const counts = {};
  for (const [, targetId] of room.dayVotes) {
    if (targetId === 'skip') continue;
    counts[targetId] = (counts[targetId] || 0) + 1;
  }
  return counts;
}

function emitGameState(room) {
  for (const [id, p] of room.players) {
    const socket = io.sockets.sockets.get(id);
    if (socket) {
      // Mafia vote tallying for Mafia players
      let mafiaVoteCounts = null;
      if (p.role === ROLES.MAFIA && room.phase === PHASES.NIGHT_VOTE) {
        mafiaVoteCounts = {};
        for (const [voterId, targetId] of room.nightVotes) {
          const voter = room.players.get(voterId);
          if (voter && voter.role === ROLES.MAFIA) {
            mafiaVoteCounts[targetId] = (mafiaVoteCounts[targetId] || 0) + 1;
          }
        }
      }

      const payload = {
        phase: room.phase,
        round: room.round,
        players: getPublicPlayerList(room, id),
        roomCode: room.code,
        isHost: id === room.hostId,
        myRole: p.role,
        myFaction: p.faction,
        myAlive: p.alive,
        timerEnd: room.timerEnd,
        timer: typeof room.timer === 'number' ? room.timer : null,
        timerDuration: room.phase === PHASES.NIGHT_VOTE ? room.customTimers.NIGHT_VOTE :
                       room.phase === PHASES.DAY_ANNOUNCE ? TIMERS.DAY_ANNOUNCE :
                       room.phase === PHASES.DAY_DISCUSS ? room.customTimers.DAY_DISCUSS :
                       room.phase === PHASES.DAY_VOTE ? room.customTimers.DAY_VOTE :
                       room.phase === PHASES.DAY_RESULT ? TIMERS.DAY_RESULT : 0,
        killedPlayers: room.killedPlayers,
        lastEliminated: room.lastEliminated,
        gameLog: room.gameLog.slice(-10),
        nightVoteCount: room.phase === PHASES.NIGHT_VOTE ? room.nightVotes.size : 0,
        dayVoteCount: room.phase === PHASES.DAY_VOTE ? room.dayVotes.size : 0,
        dayVoteCounts: room.phase === PHASES.DAY_VOTE ? getDayVoteCounts(room) : {},
        mafiaVoteCounts: mafiaVoteCounts,
        skipVoteCount: room.phase === PHASES.DAY_VOTE ? Array.from(room.dayVotes.values()).filter(v => v === 'skip').length : 0,
        hasVoted: room.phase === PHASES.NIGHT_VOTE ? room.nightVotes.has(id) : 
                  room.phase === PHASES.DAY_VOTE ? room.dayVotes.has(id) : false,
        doctorUsed: room.phase === PHASES.NIGHT_VOTE && p.role === ROLES.DOCTOR ? room.doctorSave !== null : false,
        detectiveUsed: room.phase === PHASES.NIGHT_VOTE && p.role === ROLES.DETECTIVE ? room.detectiveCheck !== null : false,
        skipDiscussVoteCount: room.phase === PHASES.DAY_DISCUSS ? room.skipDiscussVotes.size : 0,
        hasVotedSkipDiscuss: room.phase === PHASES.DAY_DISCUSS ? room.skipDiscussVotes.has(id) : false,
        hasConfirmedNight: room.phase === PHASES.NIGHT_VOTE ? room.nightConfirmations.has(id) : false,
        nightConfirmCount: room.phase === PHASES.NIGHT_VOTE ? room.nightConfirmations.size : 0,
        nightActiveCount: room.phase === PHASES.NIGHT_VOTE ? getAlivePlayers(room).length : 0,
        hasConfirmedDay: room.phase === PHASES.DAY_VOTE ? room.dayConfirmations.has(id) : false,
        dayConfirmCount: room.phase === PHASES.DAY_VOTE ? room.dayConfirmations.size : 0,
        veteranAlert: room.phase === PHASES.NIGHT_VOTE && p.role === ROLES.VETERAN ? room.veteranAlerts.has(id) : false,
        veteranUsed: p.role === ROLES.VETERAN ? room.veteranUsed.has(id) : false,
        sheriffUsed: p.role === ROLES.SHERIFF ? room.sheriffUsed.has(id) : false,
        curiousUsed: room.phase === PHASES.NIGHT_VOTE && p.role === ROLES.CURIOUS ? room.curiousCheck !== null : false,
        rolesInPlay: room.rolesInPlay || []
      };
      socket.emit('gameState', payload);
    }
  }
}

// ================== GAME FLOW ==================

function startGame(room, customSettings) {
  if (!assignRoles(room, customSettings)) return false;
  
  if (customSettings) {
    room.customTimers.NIGHT_VOTE = Math.max(60, parseInt(customSettings.timeNight) * 60 || 60);
    room.customTimers.DAY_DISCUSS = Math.max(60, parseInt(customSettings.timeDiscuss) * 60 || 60);
    room.customTimers.DAY_VOTE = Math.max(60, parseInt(customSettings.timeVote) * 60 || 60);
    room.revealRoleOnDeath = customSettings.revealRoleOnDeath !== false;
  } else {
    room.customTimers = { ...TIMERS };
    room.revealRoleOnDeath = true;
  }
  
  room.round = 0;
  room.gameLog = [];
  room.jesterWin = false;
  room.lastKilled = null;
  room.lastEliminated = null;

  addLog(room, '🎮 เกมเริ่มแล้ว! ทุกคนได้รับบทบาทแล้ว');
  
  // Notify each player of their role
  for (const [id, p] of room.players) {
    io.to(id).emit('roleAssigned', {
      role: p.role,
      roleName: ROLE_NAMES_TH[p.role],
      faction: p.faction,
      factionName: FACTION_NAMES_TH[p.faction]
    });
  }

  // Start starting phase with countdown (Exactly 3 seconds)
  room.phase = PHASES.STARTING;
  room.timer = 3;
  emitGameState(room);

  let countdown = 3;
  const countdownInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      room.timer = countdown;
      emitGameState(room);
    } else {
      clearInterval(countdownInterval);
      startNight(room);
    }
  }, 1000);

  return true;
}

function startNight(room) {
  room.round++;
  room.nightVotes = new Map();
  room.doctorSave = null;
  room.detectiveCheck = null;
  room.curiousCheck = null;
  room.nightConfirmations.clear();
  room.veteranAlerts.clear();
  room.phase = PHASES.NIGHT_VOTE;
  
  addLog(room, `🌙 คืนที่ ${room.round} — มาเฟียกำลังเลือกเหยื่อ...`);
  
  // Timer for night vote
  startTimer(room, room.customTimers.NIGHT_VOTE, () => resolveNight(room));
  emitGameState(room);
}

function resolveNight(room) {
  // Count mafia votes
  const voteCount = new Map();
  for (const [, targetId] of room.nightVotes) {
    voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
  }

  // Find most voted by mafia
  let maxVotes = 0;
  let killedByMafia = null;
  for (const [targetId, count] of voteCount) {
    if (count > maxVotes) {
      maxVotes = count;
      killedByMafia = targetId;
    }
  }

  if (!killedByMafia) {
    const targets = getAlivePlayers(room).filter(p => p.role !== ROLES.MAFIA);
    if (targets.length > 0) {
      killedByMafia = targets[Math.floor(Math.random() * targets.length)].id;
    }
  }

  let killedIds = new Set();
  let deathCauses = new Map(); // targetId -> 'mafia' | 'veteran'
  
  if (killedByMafia) {
    if (room.doctorSave === killedByMafia) {
      addLog(room, `☀️ เช้าวันที่ ${room.round} — หมอช่วยชีวิตเหยื่อจากการโจมตีของมาเฟียไว้ได้!`);
    } else if (room.veteranAlerts.has(killedByMafia)) {
      addLog(room, `☀️ เช้าวันที่ ${room.round} — ทหารผ่านศึกป้องกันการโจมตีของมาเฟียไว้ได้!`);
    } else {
      killedIds.add(killedByMafia);
      deathCauses.set(killedByMafia, 'mafia');
    }
  }

  // Veteran kills visitors
  if (killedByMafia && room.veteranAlerts.has(killedByMafia)) {
    // Kill mafia who voted for this veteran (only one chosen randomly if multiple voted)
    let attackingMafia = [];
    for (const [mafiaId, targetId] of room.nightVotes) {
      if (targetId === killedByMafia) {
        const voter = room.players.get(mafiaId);
        if (voter && voter.role === ROLES.MAFIA && voter.alive) {
          attackingMafia.push(mafiaId);
        }
      }
    }
    if (attackingMafia.length > 0) {
      const chosenMafiaToDie = attackingMafia[Math.floor(Math.random() * attackingMafia.length)];
      killedIds.add(chosenMafiaToDie);
      deathCauses.set(chosenMafiaToDie, 'veteran');
    }
  }
  if (room.doctorSave && room.veteranAlerts.has(room.doctorSave)) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.DOCTOR && p.alive) {
        killedIds.add(id);
        deathCauses.set(id, 'veteran');
      }
    }
  }
  if (room.detectiveCheck && room.veteranAlerts.has(room.detectiveCheck)) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.DETECTIVE && p.alive) {
        killedIds.add(id);
        deathCauses.set(id, 'veteran');
      }
    }
  }
  if (room.curiousCheck && room.veteranAlerts.has(room.curiousCheck)) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.CURIOUS && p.alive) {
        killedIds.add(id);
        deathCauses.set(id, 'veteran');
      }
    }
  }

  // Compile night visits
  const visits = [];
  
  // Mafia visits
  for (const [voterId, targetId] of room.nightVotes) {
    const voter = room.players.get(voterId);
    const target = room.players.get(targetId);
    if (voter && voter.alive && voter.role === ROLES.MAFIA && target) {
      visits.push({ from: voterId, fromName: voter.name, to: targetId, toName: target.name, action: 'โจมตี' });
    }
  }
  
  // Doctor visits
  if (room.doctorSave) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.DOCTOR && p.alive) {
        const target = room.players.get(room.doctorSave);
        if (target) {
          visits.push({ from: id, fromName: p.name, to: room.doctorSave, toName: target.name, action: 'ปกป้อง' });
        }
      }
    }
  }

  // Detective visits
  if (room.detectiveCheck) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.DETECTIVE && p.alive) {
        const target = room.players.get(room.detectiveCheck);
        if (target) {
          visits.push({ from: id, fromName: p.name, to: room.detectiveCheck, toName: target.name, action: 'ตรวจสอบ' });
        }
      }
    }
  }

  // Curious Kid visits
  if (room.curiousCheck) {
    for (const [id, p] of room.players) {
      if (p.role === ROLES.CURIOUS && p.alive) {
        const target = room.players.get(room.curiousCheck);
        if (target) {
          visits.push({ from: id, fromName: p.name, to: room.curiousCheck, toName: target.name, action: 'เฝ้าดู' });
        }
      }
    }
  }

  // Apply deaths
  room.killedPlayers = [];
  for (const id of killedIds) {
    const victim = room.players.get(id);
    if (victim) {
      victim.alive = false;
      const reveal = room.revealRoleOnDeath !== false;
      const cause = deathCauses.get(id) || 'mafia';
      room.killedPlayers.push({ id, name: victim.name, role: reveal ? victim.role : null, cause: cause });
      const roleText = reveal ? ` (บทบาท: ${ROLE_NAMES_TH[victim.role] || victim.role})` : '';
      const causeTh = cause === 'mafia' ? 'ถูกมาเฟียสังหาร' : 'ถูกทหารผ่านศึกป้องกันตัวยิงสวนดับ';
      addLog(room, `☀️ เช้าวันที่ ${room.round} — ${victim.name} ${causeTh}!${roleText}`);
      
      // If killed by mafia, they get to know which mafia killed them!
      if (cause === 'mafia') {
        const aliveMafia = getAlivePlayers(room).filter(p => p.role === ROLES.MAFIA);
        if (aliveMafia.length > 0) {
          let votingMafia = [];
          for (const [voterId, targetId] of room.nightVotes) {
            if (targetId === id) {
              const voter = room.players.get(voterId);
              if (voter && voter.role === ROLES.MAFIA && voter.alive) {
                votingMafia.push(voter);
              }
            }
          }
          const mafiaPool = votingMafia.length > 0 ? votingMafia : aliveMafia;
          const chosenKiller = mafiaPool[Math.floor(Math.random() * mafiaPool.length)];
          
          io.to(id).emit('chatMessage', {
            senderName: '💀 ความจริงก่อนสิ้นลม',
            message: `ก่อนสิ้นลมหายใจ คุณเห็นใบหน้าของ [${chosenKiller.name}] แวบเข้ามา! เขาคือมาเฟียผู้ลงมือปลิดชีพคุณ! 🔪`,
            isSystem: true,
            color: '#e74c3c'
          });
        }
      }
    }
  }

  // Consume veteran uses
  for (const id of room.veteranAlerts) {
    room.veteranUsed.add(id);
  }

  // Morning public chat announcements for night deaths
  if (room.killedPlayers.length > 0) {
    let announceLines = [`☀️ [ประกาศยามเช้า] คืนที่ผ่านมามีผู้เสียชีวิตดังนี้:`];
    room.killedPlayers.forEach(victim => {
      const roleText = room.revealRoleOnDeath !== false ? ` (บทบาท: ${ROLE_NAMES_TH[victim.role] || victim.role})` : '';
      let causeText = '';
      if (victim.cause === 'mafia') {
        causeText = 'โดนมาเฟียฆ่าตาย 🔪';
      } else if (victim.cause === 'veteran') {
        causeText = 'ถูกทหารผ่านศึกฆ่าตาย 🎖️';
      } else {
        causeText = 'เสียชีวิตจากสาเหตุลึกลับ 👻';
      }
      announceLines.push(`💀 [${victim.name}] ${causeText}${roleText}`);
    });
    
    io.to(room.code).emit('chatMessage', {
      senderName: '📢 ประกาศจากหมู่บ้าน',
      message: announceLines.join('\n'),
      isSystem: true,
      color: '#e74c3c'
    });
  } else {
    addLog(room, `☀️ เช้าวันที่ ${room.round} — ไม่มีใครถูกฆ่าเมื่อคืน`);
    io.to(room.code).emit('chatMessage', {
      senderName: '📢 ประกาศจากหมู่บ้าน',
      message: `☀️ [ประกาศยามเช้า] เมื่อคืนที่ผ่านมานอนหลับสบายดี... ไม่มีใครเสียชีวิตในคืนนี้! 😊`,
      isSystem: true,
      color: '#2ecc71'
    });
  }

  // Send result to detective
  if (room.detectiveCheck) {
    const target = room.players.get(room.detectiveCheck);
    if (target) {
      for (const [id, p] of room.players) {
        if (p.role === ROLES.DETECTIVE && p.alive) {
          io.to(id).emit('detectiveResult', {
            targetName: target.name,
            isMafia: target.role === ROLES.MAFIA
          });
        }
      }
    }
  }

  // Send Curious Kid report
  if (room.curiousCheck) {
    const targetId = room.curiousCheck;
    const target = room.players.get(targetId);
    if (target) {
      for (const [curId, curPlayer] of room.players) {
        if (curPlayer.role === ROLES.CURIOUS && curPlayer.alive) {
          const outgoing = visits.filter(v => v.from === targetId);
          const incoming = visits.filter(v => v.to === targetId && v.from !== curId);
          
          let reportLines = [`🕵️‍♂️ [รายงานเด็กขี้สงสัย] ผลการแอบซุ่มดูเป้าหมาย [${target.name}] คืนนี้:`];
          
          if (outgoing.length > 0) {
            outgoing.forEach(v => {
              reportLines.push(`👉 เขาแอบออกไปหา: [${v.toName}]`);
            });
          } else {
            reportLines.push(`👉 เขาไม่ได้แอบออกไปหาใครเลย`);
          }
          
          if (incoming.length > 0) {
            incoming.forEach(v => {
              reportLines.push(`👈 มีคนแอบเดินทางมาหาเขาเพื่อใช้แอคชั่น: [${v.fromName}]`);
            });
          } else {
            reportLines.push(`👈 ไม่มีใครเดินทางมาหาเขาเลย`);
          }
          
          io.to(curId).emit('chatMessage', {
            senderName: '🕵️‍♂️ เด็กขี้สงสัย',
            message: reportLines.join('\n'),
            isSystem: true,
            color: '#ba68c8'
          });
        }
      }
    }
  }

  // Check win condition
  const winResult = checkWinCondition(room);
  if (winResult) {
    endGame(room, winResult);
    return;
  }

  // Move to day announce
  room.phase = PHASES.DAY_ANNOUNCE;
  startTimer(room, TIMERS.DAY_ANNOUNCE, () => startDayDiscussion(room));
  emitGameState(room);
}

function startDayDiscussion(room) {
  room.phase = PHASES.DAY_DISCUSS;
  room.killedPlayers = [];
  room.skipDiscussVotes.clear();
  addLog(room, `💬 เวลาพูดคุย — หาว่าใครคือมาเฟีย!`);
  startTimer(room, room.customTimers.DAY_DISCUSS, () => startDayVote(room));
  emitGameState(room);
}

function startDayVote(room) {
  room.phase = PHASES.DAY_VOTE;
  room.dayVotes = new Map();
  room.dayConfirmations.clear();
  addLog(room, `🗳️ เวลาโหวต — เลือกคนที่จะถูกกำจัดออกจากหมู่บ้าน`);
  startTimer(room, room.customTimers.DAY_VOTE, () => resolveDayVote(room));
  emitGameState(room);
}

function resolveDayVote(room) {
  // Count votes
  const voteCount = new Map();
  for (const [, targetId] of room.dayVotes) {
    if (targetId === 'skip') continue;
    voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
  }

  // Find most voted
  let maxVotes = 0;
  let eliminated = null;
  let tie = false;
  
  for (const [targetId, count] of voteCount) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = targetId;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  // Need majority (more than half of alive players) or at least 2 votes and no tie
  const aliveCount = getAlivePlayers(room).length;
  const threshold = Math.floor(aliveCount / 2);

  if (eliminated && maxVotes > threshold && !tie) {
    const victim = room.players.get(eliminated);
    if (victim) {
      victim.alive = false;
      const reveal = room.revealRoleOnDeath !== false;
      room.lastEliminated = { id: eliminated, name: victim.name, role: reveal ? victim.role : null };
      const roleText = reveal ? ` (${ROLE_NAMES_TH[victim.role] || victim.role})` : '';
      addLog(room, `⚖️ ${victim.name}${roleText} ถูกโหวตออกจากหมู่บ้าน!`);
      
      // Check if jester was eliminated
      if (victim.role === ROLES.JESTER) {
        room.jesterWin = true;
      }
    }
  } else {
    room.lastEliminated = null;
    if (tie) {
      addLog(room, `⚖️ ผลโหวตเสมอกัน — ไม่มีใครถูกกำจัด`);
    } else {
      addLog(room, `⚖️ คะแนนโหวตไม่เพียงพอ — ไม่มีใครถูกกำจัด`);
    }
  }

  // Check win condition
  const winResult = checkWinCondition(room);
  if (winResult) {
    endGame(room, winResult);
    return;
  }

  // Show result
  room.phase = PHASES.DAY_RESULT;
  emitGameState(room);

  startTimer(room, TIMERS.DAY_RESULT, () => {
    room.lastEliminated = null;
    startNight(room);
  });
}

function endGame(room, winResult) {
  clearRoomTimer(room);
  room.phase = PHASES.GAME_OVER;
  addLog(room, `🏆 ${winResult.reason}`);
  
  for (const [id, p] of room.players) {
    const socket = io.sockets.sockets.get(id);
    if (socket) {
      socket.emit('gameOver', {
        winner: winResult.winner,
        winnerName: FACTION_NAMES_TH[winResult.winner],
        reason: winResult.reason,
        isWinner: p.faction === winResult.winner,
        players: Array.from(room.players.values()).map(pl => ({
          name: pl.name,
          role: pl.role,
          roleName: ROLE_NAMES_TH[pl.role],
          faction: pl.faction,
          factionName: FACTION_NAMES_TH[pl.faction],
          alive: pl.alive
        }))
      });
    }
  }
  
  emitGameState(room);
}

function addLog(room, message) {
  room.gameLog.push({
    time: Date.now(),
    message
  });
}

// ================== SOCKET HANDLERS ==================
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);
  let currentRoom = null;

  socket.on('createRoom', ({ playerName, avatar }) => {
    const room = createRoom(socket.id, playerName);
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      avatar: avatar || 0,
      role: null,
      faction: null,
      alive: true
    });
    currentRoom = room.code;
    socket.join(room.code);
    socket.emit('roomCreated', { roomCode: room.code });
    emitGameState(room);
  });

  socket.on('joinRoom', ({ roomCode, playerName, avatar }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    
    if (!room) {
      socket.emit('error', { message: 'ไม่พบห้อง กรุณาตรวจสอบรหัสห้อง' });
      return;
    }
    if (room.phase !== PHASES.LOBBY) {
      socket.emit('error', { message: 'เกมเริ่มไปแล้ว ไม่สามารถเข้าร่วมได้' });
      return;
    }
    if (room.players.size >= 10) {
      socket.emit('error', { message: 'ห้องเต็มแล้ว (สูงสุด 10 คน)' });
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      avatar: avatar || 0,
      role: null,
      faction: null,
      alive: true
    });
    currentRoom = code;
    socket.join(code);
    socket.emit('roomJoined', { roomCode: code });
    addLog(room, `📢 ${playerName} เข้าร่วมห้อง`);
    emitGameState(room);
  });

  socket.on('startGame', (customSettings) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'เฉพาะเจ้าของห้องเท่านั้นที่เริ่มเกมได้' });
      return;
    }
    if (room.players.size < 4) {
      socket.emit('error', { message: 'ต้องมีผู้เล่นอย่างน้อย 4 คน' });
      return;
    }
    if (room.phase !== PHASES.LOBBY && room.phase !== PHASES.GAME_OVER) {
      socket.emit('error', { message: 'เกมกำลังดำเนินอยู่' });
      return;
    }

    // Reset players
    for (const [, p] of room.players) {
      p.role = null;
      p.faction = null;
      p.alive = true;
    }

    startGame(room, customSettings);
  });

  socket.on('skipDiscuss', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.DAY_DISCUSS) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    room.skipDiscussVotes.add(socket.id);
    emitGameState(room);

    const aliveCount = getAlivePlayers(room).length;
    const threshold = Math.ceil(aliveCount / 2);
    
    if (room.skipDiscussVotes.size >= threshold) {
      clearRoomTimer(room);
      addLog(room, `⏩ ผู้เล่นส่วนใหญ่โหวตข้ามเวลาพูดคุย`);
      setTimeout(() => startDayVote(room), 1000);
    }
  });

  socket.on('confirmNight', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    
    room.nightConfirmations.add(socket.id);
    emitGameState(room);

    const activePlayers = getAlivePlayers(room);
    if (room.nightConfirmations.size >= activePlayers.length) {
      clearRoomTimer(room);
      setTimeout(() => resolveNight(room), 500);
    }
  });

  socket.on('nightVote', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.MAFIA) return;
    
    const target = room.players.get(targetId);
    if (!target || !target.alive) return;

    room.nightVotes.set(socket.id, targetId);
    emitGameState(room);
  });

  socket.on('doctorSave', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.DOCTOR) return;
    
    const target = room.players.get(targetId);
    if (!target || !target.alive) return;

    room.doctorSave = targetId;
    emitGameState(room);
  });

  socket.on('detectiveCheck', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.DETECTIVE) return;
    
    const target = room.players.get(targetId);
    if (!target || !target.alive) return;

    room.detectiveCheck = targetId;
    
    emitGameState(room);
  });

  socket.on('curiousCheck', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.CURIOUS) return;
    
    const target = room.players.get(targetId);
    if (!target || !target.alive) return;

    room.curiousCheck = targetId;
    
    emitGameState(room);
  });

  socket.on('veteranAlert', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.NIGHT_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.VETERAN) return;
    if (room.veteranUsed.has(socket.id)) return;

    if (room.veteranAlerts.has(socket.id)) {
      room.veteranAlerts.delete(socket.id);
    } else {
      room.veteranAlerts.add(socket.id);
    }
    emitGameState(room);
  });

  socket.on('sheriffShoot', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || (room.phase !== PHASES.DAY_DISCUSS && room.phase !== PHASES.DAY_VOTE)) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.role !== ROLES.SHERIFF) return;
    if (room.sheriffUsed.has(socket.id)) return;
    
    const target = room.players.get(targetId);
    if (!target || !target.alive || target.id === socket.id) return;

    room.sheriffUsed.add(socket.id);
    target.alive = false;
    
    let msg = `🤠 นายอำเภอ ${player.name} ตัดสินใจยิง ${target.name}! (${ROLE_NAMES_TH[target.role] || target.role})`;
    
    if (target.faction === FACTIONS.GOOD) {
      player.alive = false;
      msg += `\n💔 อนิจจา! ${target.name} เป็นคนดี นายอำเภอ ${player.name} จึงตรอมใจตายตามไปด้วย!`;
    }
    
    addLog(room, msg);
    
    // Broadcast message to everyone
    io.to(currentRoom).emit('chatMessage', {
      senderName: 'ระบบ',
      message: msg,
      isSystem: true,
      color: '#ff9800'
    });

    // Broadcast the bullet shoot cutscene effect to all players in the room!
    io.to(currentRoom).emit('sheriffShotEffect', {
      targetName: target.name,
      sheriffName: player.name,
      backfire: target.faction === FACTIONS.GOOD
    });

    emitGameState(room);

    // Check win condition instantly
    const winResult = checkWinCondition(room);
    if (winResult) {
      setTimeout(() => endGame(room, winResult), 1000);
    }
  });

  socket.on('confirmDayVote', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.DAY_VOTE) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    
    // Only allow confirm if they actually voted
    if (!room.dayVotes.has(socket.id)) return;
    
    room.dayConfirmations.add(socket.id);
    checkDayVoteEnd(room);
  });

  socket.on('dayVote', ({ targetId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== PHASES.DAY_VOTE) return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    if (targetId !== 'skip') {
      const target = room.players.get(targetId);
      if (!target || !target.alive) return;
    }

    room.dayVotes.set(socket.id, targetId);
    if (targetId === 'skip') {
      room.dayConfirmations.add(socket.id);
    }
    
    checkDayVoteEnd(room);
  });

  function checkDayVoteEnd(room) {
    const alivePlayers = getAlivePlayers(room);
    let allConfirmed = true;
    for (const p of alivePlayers) {
      if (!room.dayConfirmations.has(p.id) && room.dayVotes.get(p.id) !== 'skip') {
        allConfirmed = false;
        break;
      }
    }
    
    if (allConfirmed) {
      clearTimeout(room.timer);
      resolveDayVote(room);
    } else {
      emitGameState(room);
    }
  }

  socket.on('returnToLobby', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.phase = PHASES.LOBBY;
    room.gameLog = [];
    room.jesterWin = false;
    room.veteranUsed.clear();
    room.sheriffUsed.clear();
    room.veteranAlerts.clear();
    for (const [id, p] of room.players) {
      p.alive = true;
      p.role = null;
      p.faction = null;
    }
    emitGameState(room);
  });

  socket.on('chatMessage', ({ message, toMafiaOnly }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    const player = room.players.get(socket.id);
    if (!player) return;

    // During lobby or game over, everyone chats together
    if (room.phase === PHASES.LOBBY || room.phase === PHASES.GAME_OVER) {
      io.to(currentRoom).emit('chatMessage', {
        senderId: socket.id,
        senderName: player.name,
        message,
        isMafiaChat: false,
        timestamp: Date.now()
      });
      return;
    }

    // Dead player chat (Ghost Chat)
    if (!player.alive) {
      const msgData = {
        senderId: socket.id,
        senderName: `👻 ${player.name}`,
        message,
        isGhostChat: true,
        timestamp: Date.now(),
        color: '#9e9e9e' // Grey for ghosts
      };
      
      // Send to all dead players + living Mediums (only at night)
      for (const [id, p] of room.players) {
        if (!p.alive || (p.role === ROLES.MEDIUM && p.alive && room.phase === PHASES.NIGHT_VOTE)) {
          io.to(id).emit('chatMessage', msgData);
        }
      }
      return;
    }

    // Alive player chat
    if (room.phase === PHASES.NIGHT_VOTE) {
      if (player.role === ROLES.MAFIA) {
        // Mafia chat
        const msgData = {
          senderId: socket.id,
          senderName: player.name,
          message,
          isMafiaChat: true,
          timestamp: Date.now()
        };
        for (const [id, p] of room.players) {
          if (p.role === ROLES.MAFIA) {
            io.to(id).emit('chatMessage', msgData);
          }
        }
      } else if (player.role === ROLES.MEDIUM) {
        // Medium talking to ghosts at night
        const msgData = {
          senderId: socket.id,
          senderName: `🔮 หมอผี ${player.name}`,
          message,
          isGhostChat: true,
          timestamp: Date.now(),
          color: '#ba68c8' // Purple for medium
        };
        for (const [id, p] of room.players) {
          if (!p.alive || (p.role === ROLES.MEDIUM && p.alive)) {
            io.to(id).emit('chatMessage', msgData);
          }
        }
      }
      return;
    }

    // Alive player chat during day
    if (room.phase === PHASES.DAY_DISCUSS || room.phase === PHASES.DAY_VOTE) {
      if (toMafiaOnly && player.role === ROLES.MAFIA) {
        // Private Mafia Chat during the day!
        const msgData = {
          senderId: socket.id,
          senderName: `🕵️‍♂️ [มาเฟียลับ] ${player.name}`,
          message,
          isMafiaChat: true,
          timestamp: Date.now()
        };
        for (const [id, p] of room.players) {
          if (p.role === ROLES.MAFIA) {
            io.to(id).emit('chatMessage', msgData);
          }
        }
        return;
      }

      io.to(currentRoom).emit('chatMessage', {
        senderId: socket.id,
        senderName: player.name,
        message,
        isMafiaChat: false,
        timestamp: Date.now()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      addLog(room, `📢 ${player.name} ออกจากห้อง`);
    }

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      clearRoomTimer(room);
      rooms.delete(currentRoom);
      return;
    }

    // Transfer host if host left
    if (socket.id === room.hostId) {
      room.hostId = room.players.keys().next().value;
    }

    // If game is running, mark as dead
    if (room.phase !== PHASES.LOBBY) {
      const winResult = checkWinCondition(room);
      if (winResult) {
        endGame(room, winResult);
        return;
      }
    }

    emitGameState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Mafia Game Server running on http://localhost:${PORT}`);
});
