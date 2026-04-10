// ============================================================
// NetClient — networked PvP over Firebase Realtime Database
// ============================================================
//
// FIRST-TIME SETUP (see README.md for screenshots):
//   1. Create a Firebase project at https://console.firebase.google.com
//      (disable Analytics — you don't need it)
//   2. Build → Realtime Database → Create Database → any region →
//      Start in locked mode
//   3. Rules tab → paste the rules block from README.md → Publish
//   4. Project Settings → Your apps → </> (Web) → register app →
//      copy the firebaseConfig values below
//
// The API key is NOT a secret. It identifies your project to Google;
// security lives in the Database Rules. Committing this file is safe.
// See: https://firebase.google.com/docs/projects/api-keys

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCGA7U51laieQRRlTMKbtdfwE6EdGCK-Aw",
  authDomain: "hyrulechess.firebaseapp.com",
  databaseURL: "https://hyrulechess-default-rtdb.firebaseio.com",
  projectId: "hyrulechess",
  storageBucket: "hyrulechess.firebasestorage.app",
  messagingSenderId: "348684027699",
  appId: "1:348684027699:web:341a712f40b791b7ba6046",
  measurementId: "G-XD9D0474GW"
};

// ============================================================

(function () {
  'use strict';

  // ---------- Internal state ----------
  let _db = null;
  let _roomRef = null;
  let _movesRef = null;
  let _roomCode = null;
  let _myColor = null;
  let _myName = null;
  let _opponentName = null;
  let _clientId = null;
  let _uid = null;
  let _lastSeq = -1;
  let _initialized = false;
  let _connected = true;              // Firebase .info/connected state
  let _heartbeatTimer = null;         // setInterval handle for lastSeen ping
  let _connectionListenerAttached = false;

  // Listener handles so we can detach cleanly on leaveRoom
  let _handles = [];

  // User-provided callbacks
  let _cbMoveReceived = null;
  let _cbOpponentJoined = null;
  let _cbOpponentLeft = null;
  let _cbResign = null;
  let _cbRematchAccepted = null;
  let _cbConnectionChange = null;     // fires with (isConnected: boolean)
  let _cbOpponentHeartbeat = null;    // fires with (lastSeenMs: number)

  // ---------- Constants ----------
  const NAME_KEY = 'zledaChess.playerName';
  const RESUME_KEY = 'zledaChess.resume.v2';  // bumped: moved session → local storage
  const LEGACY_RESUME_KEY = 'zledaChess.resume';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/I/1
  const CODE_LEN = 5;
  const NAME_MAX = 16;
  const RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
  const HEARTBEAT_MS = 15000;                      // 15s between presence pings
  const RESUME_RETRIES = 3;
  const RESUME_RETRY_BASE_MS = 600;

  // ---------- Helpers ----------
  function isConfigured() {
    return FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.apiKey !== 'PASTE_HERE' &&
      FIREBASE_CONFIG.databaseURL;
  }

  function trimName(name) {
    if (!name) return 'Player';
    const t = String(name).trim().slice(0, NAME_MAX);
    return t || 'Player';
  }

  function randomCode() {
    let out = '';
    for (let i = 0; i < CODE_LEN; i++) {
      out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
  }

  function randomClientId() {
    return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function getSavedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }
  function setSavedName(name) {
    try { localStorage.setItem(NAME_KEY, trimName(name)); } catch (e) { }
  }

  // Resume storage moved from sessionStorage (tab-scoped) to localStorage so
  // the user can come back hours or days later. Entries carry a savedAt
  // timestamp and are expired after RESUME_TTL_MS on read. We also migrate
  // any legacy sessionStorage entry on the first read.
  function getSavedResume() {
    try {
      let raw = localStorage.getItem(RESUME_KEY);
      if (!raw) {
        // Migrate legacy sessionStorage entry (one-time, best-effort)
        const legacy = sessionStorage.getItem(LEGACY_RESUME_KEY);
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            parsed.savedAt = Date.now();
            localStorage.setItem(RESUME_KEY, JSON.stringify(parsed));
            sessionStorage.removeItem(LEGACY_RESUME_KEY);
            raw = JSON.stringify(parsed);
          } catch (e) { /* ignore */ }
        }
      }
      if (!raw) return null;
      const obj = JSON.parse(raw);
      // TTL guard
      if (obj.savedAt && (Date.now() - obj.savedAt) > RESUME_TTL_MS) {
        localStorage.removeItem(RESUME_KEY);
        return null;
      }
      return obj;
    } catch (e) { return null; }
  }
  function saveResume(obj) {
    try {
      const payload = Object.assign({}, obj, { savedAt: Date.now() });
      localStorage.setItem(RESUME_KEY, JSON.stringify(payload));
    } catch (e) { }
  }
  function clearResume() {
    try {
      localStorage.removeItem(RESUME_KEY);
      sessionStorage.removeItem(LEGACY_RESUME_KEY);
    } catch (e) { }
  }

  // ---------- Firebase init ----------
  // init() returns a Promise<boolean>. The first call signs in anonymously
  // (Firebase Database rules require auth != null). Subsequent calls resolve
  // immediately. Anonymous auth means no PII is collected — Firebase issues
  // a random UID per browser session.
  let _initPromise = null;
  function init() {
    if (_initialized) return Promise.resolve(true);
    if (_initPromise) return _initPromise;
    if (!isConfigured()) {
      console.warn('[NetClient] Firebase not configured — edit net.js FIREBASE_CONFIG to enable online play.');
      return Promise.resolve(false);
    }
    if (typeof firebase === 'undefined') {
      console.error('[NetClient] Firebase SDK not loaded. Check <script> tags in index.html.');
      return Promise.resolve(false);
    }
    _initPromise = (async () => {
      try {
        if (firebase.apps && firebase.apps.length === 0) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        // Anonymous sign-in (required by tightened database rules).
        // If the Anonymous provider isn't enabled in the Firebase console,
        // this throws "auth/operation-not-allowed" — surface a clear hint.
        const cred = await firebase.auth().signInAnonymously();
        _uid = (cred && cred.user && cred.user.uid) ||
               (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
        _db = firebase.database();
        _attachConnectionListener();
        _initialized = true;
        return true;
      } catch (e) {
        console.error('[NetClient] init failed:', e);
        if (e && e.code === 'auth/operation-not-allowed') {
          console.error('[NetClient] Enable Anonymous Auth in Firebase console: https://console.firebase.google.com/project/' + FIREBASE_CONFIG.projectId + '/authentication/providers');
        }
        _initPromise = null; // allow retry on next call
        return false;
      }
    })();
    return _initPromise;
  }

  // ---------- Room lifecycle ----------
  async function createRoom(name) {
    if (!(await init())) throw new Error('Firebase init failed — check console for details');
    const myName = trimName(name);
    setSavedName(myName);

    // Try up to 5 random codes to avoid collision with an active room
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode();
      const snap = await _db.ref('rooms/' + candidate).once('value');
      const room = snap.val();
      if (!room || room.status === 'ended') { code = candidate; break; }
    }
    if (!code) throw new Error('Could not allocate room code — please retry');

    _clientId = randomClientId();
    _roomCode = code;
    _myColor = 'w';
    _myName = myName;
    _opponentName = null;
    _lastSeq = -1;

    _roomRef = _db.ref('rooms/' + code);
    _movesRef = _roomRef.child('moves');

    // Write the room skeleton
    await _roomRef.set({
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      lastActivity: firebase.database.ServerValue.TIMESTAMP,
      status: 'waiting',
      host: {
        clientId: _clientId,
        online: true,
        name: myName,
        uid: _uid || '',
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      },
      guest: { clientId: '', online: false, name: '' },
      resign: null,
      rematch: { w: false, b: false },
    });

    // onDisconnect cleanup — fires server-side when our TCP drops
    _roomRef.child('host/online').onDisconnect().set(false);

    saveResume({ code, myColor: 'w', clientId: _clientId, name: myName });
    _attachListeners();
    _startHeartbeat();
    return { code, myColor: 'w', myName };
  }

  async function joinRoom(code, name) {
    if (!(await init())) throw new Error('Firebase init failed — check console for details');
    if (!code || typeof code !== 'string') throw new Error('Invalid room code');
    code = code.trim().toUpperCase();

    const myName = trimName(name);
    setSavedName(myName);

    const snap = await _db.ref('rooms/' + code).once('value');
    const room = snap.val();
    if (!room) throw new Error('Room not found: ' + code);
    if (room.status === 'ended') throw new Error('That room has already ended');
    if (room.guest && room.guest.clientId) {
      throw new Error('Room is full');
    }

    _clientId = randomClientId();
    _roomCode = code;
    _myColor = 'b';
    _myName = myName;
    _opponentName = (room.host && room.host.name) || 'Opponent';
    _lastSeq = -1;

    _roomRef = _db.ref('rooms/' + code);
    _movesRef = _roomRef.child('moves');

    // Claim the guest slot
    await _roomRef.child('guest').set({
      clientId: _clientId,
      online: true,
      name: myName,
      uid: _uid || '',
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
    });
    await _roomRef.child('status').set('playing');
    await _roomRef.child('lastActivity').set(firebase.database.ServerValue.TIMESTAMP);
    _roomRef.child('guest/online').onDisconnect().set(false);

    // Read any existing moves (shouldn't be any for a fresh join, but could be for rejoin)
    const movesSnap = await _movesRef.once('value');
    const existingMoves = [];
    movesSnap.forEach((child) => {
      const mv = child.val();
      const seq = parseInt(child.key, 10);
      if (!Number.isNaN(seq)) existingMoves.push(Object.assign({}, mv, { seq }));
    });
    existingMoves.sort((a, b) => a.seq - b.seq);
    if (existingMoves.length > 0) {
      _lastSeq = existingMoves[existingMoves.length - 1].seq;
    }

    saveResume({ code, myColor: 'b', clientId: _clientId, name: myName });
    _attachListeners();
    _startHeartbeat();
    return {
      myColor: 'b',
      myName,
      opponentName: _opponentName,
      existingMoves,
      status: 'playing',
    };
  }

  // Small delay helper used by the retry loop.
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Inner resume routine — runs once; the outer resumeRoom() retries it with
  // exponential backoff on transient errors. "Permanent" errors (room gone,
  // slot taken by someone else) short-circuit out of the retry loop.
  async function _resumeRoomOnce(code, onStatus) {
    const saved = getSavedResume();
    if (!saved || saved.code !== code) {
      const err = new Error('No resume data for ' + code);
      err.permanent = true;
      throw err;
    }

    if (onStatus) onStatus('Reading room state…');
    const snap = await _db.ref('rooms/' + code).once('value');
    const room = snap.val();
    if (!room) {
      clearResume();
      const err = new Error('Room expired');
      err.permanent = true;
      throw err;
    }
    if (room.status === 'ended') {
      clearResume();
      const err = new Error('Room already ended');
      err.permanent = true;
      throw err;
    }

    const slot = saved.myColor === 'w' ? 'host' : 'guest';
    if (!room[slot] || room[slot].clientId !== saved.clientId) {
      clearResume();
      const err = new Error('Slot no longer belongs to you — join as a new player');
      err.permanent = true;
      throw err;
    }

    _clientId = saved.clientId;
    _roomCode = code;
    _myColor = saved.myColor;
    _myName = trimName(saved.name);
    const otherSlot = slot === 'host' ? 'guest' : 'host';
    _opponentName = (room[otherSlot] && room[otherSlot].name) || null;
    _lastSeq = -1;

    _roomRef = _db.ref('rooms/' + code);
    _movesRef = _roomRef.child('moves');

    if (onStatus) onStatus('Reclaiming your seat…');
    // Mark ourselves back online + refresh presence metadata
    await _roomRef.child(slot).update({
      online: true,
      uid: _uid || '',
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
    });
    _roomRef.child(slot + '/online').onDisconnect().set(false);
    await _roomRef.child('lastActivity').set(firebase.database.ServerValue.TIMESTAMP);

    if (onStatus) onStatus('Replaying moves…');
    // Pull the full move history to replay locally
    const movesSnap = await _movesRef.once('value');
    const existingMoves = [];
    movesSnap.forEach((child) => {
      const mv = child.val();
      const seq = parseInt(child.key, 10);
      if (!Number.isNaN(seq)) existingMoves.push(Object.assign({}, mv, { seq }));
    });
    existingMoves.sort((a, b) => a.seq - b.seq);
    if (existingMoves.length > 0) {
      _lastSeq = existingMoves[existingMoves.length - 1].seq;
    }

    _attachListeners();
    _startHeartbeat();
    return {
      myColor: _myColor,
      myName: _myName,
      opponentName: _opponentName,
      existingMoves,
      status: room.status,
      lastActivity: room.lastActivity || null,
    };
  }

  // Public resume — retries transient errors with exponential backoff.
  // onStatus is an optional function(string) that receives progress updates.
  async function resumeRoom(code, onStatus) {
    if (!(await init())) throw new Error('Firebase init failed — check console for details');
    let lastErr = null;
    for (let attempt = 0; attempt < RESUME_RETRIES; attempt++) {
      if (attempt > 0 && onStatus) onStatus('Reconnecting (attempt ' + (attempt + 1) + '/' + RESUME_RETRIES + ')…');
      try {
        return await _resumeRoomOnce(code, onStatus);
      } catch (e) {
        lastErr = e;
        if (e && e.permanent) throw e;
        if (attempt < RESUME_RETRIES - 1) {
          await _sleep(RESUME_RETRY_BASE_MS * Math.pow(2, attempt));
        }
      }
    }
    throw lastErr || new Error('Resume failed');
  }

  // Soft leave: clean up listeners and in-memory state but KEEP the resume
  // entry so the user can come back later. Used by the "Menu" button.
  function leaveRoom() {
    _stopHeartbeat();
    _detachListeners();
    if (_roomRef && _myColor) {
      const slot = _myColor === 'w' ? 'host' : 'guest';
      try { _roomRef.child(slot + '/online').set(false); } catch (e) { }
    }
    _roomRef = null;
    _movesRef = null;
    _roomCode = null;
    _myColor = null;
    _myName = null;
    _opponentName = null;
    _clientId = null;
    _lastSeq = -1;
  }

  // Hard leave: everything leaveRoom() does PLUS clear the resume entry,
  // so the user can no longer come back. Used for explicit resign, game
  // over, or when the user clicks Create/Join (a fresh session).
  function abandonRoom() {
    leaveRoom();
    clearResume();
  }

  // ---------- Move sync ----------
  async function sendMove(moveMeta) {
    if (!_movesRef) throw new Error('Not in a room');
    const seq = _lastSeq + 1;
    const payload = {
      fromRow: moveMeta.fromRow,
      fromCol: moveMeta.fromCol,
      toRow: moveMeta.toRow,
      toCol: moveMeta.toCol,
      promoteTo: moveMeta.promoteTo || null,
      author: _myColor,
      ts: firebase.database.ServerValue.TIMESTAMP,
    };
    _lastSeq = seq;
    await _movesRef.child(String(seq)).set(payload);
    // Bump activity timestamp so cleanup jobs know this room is alive
    if (_roomRef) {
      _roomRef.child('lastActivity').set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
    }
  }

  // ---------- Connection + heartbeat ----------
  // Single global listener on Firebase's .info/connected node. Survives
  // across room lifecycles so a page-level UI banner can reflect network
  // state even when no room is active.
  function _attachConnectionListener() {
    if (_connectionListenerAttached || !_db) return;
    _connectionListenerAttached = true;
    _db.ref('.info/connected').on('value', (snap) => {
      const v = snap.val() === true;
      if (v === _connected) return;
      _connected = v;
      if (_cbConnectionChange) _cbConnectionChange(_connected);
      // When we bounce back online, refresh slot presence + lastActivity.
      if (v && _roomRef && _myColor) {
        const slot = _myColor === 'w' ? 'host' : 'guest';
        try {
          _roomRef.child(slot).update({
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
          });
          _roomRef.child(slot + '/online').onDisconnect().set(false);
          _roomRef.child('lastActivity').set(firebase.database.ServerValue.TIMESTAMP);
        } catch (e) { /* ignore */ }
      }
    });
  }

  function _startHeartbeat() {
    _stopHeartbeat();
    if (!_roomRef || !_myColor) return;
    const slot = _myColor === 'w' ? 'host' : 'guest';
    const ping = () => {
      if (!_roomRef) return;
      try {
        _roomRef.child(slot + '/lastSeen').set(firebase.database.ServerValue.TIMESTAMP);
      } catch (e) { /* ignore */ }
    };
    ping(); // immediate
    _heartbeatTimer = setInterval(ping, HEARTBEAT_MS);
  }
  function _stopHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  // Force a presence refresh — called from the page on visibilitychange to
  // speed up recovery after tab suspension.
  function refreshPresence() {
    if (!_roomRef || !_myColor) return;
    const slot = _myColor === 'w' ? 'host' : 'guest';
    try {
      _roomRef.child(slot).update({
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      });
      _roomRef.child(slot + '/online').onDisconnect().set(false);
      _roomRef.child('lastActivity').set(firebase.database.ServerValue.TIMESTAMP);
    } catch (e) { /* ignore */ }
  }

  function onMoveReceived(cb) { _cbMoveReceived = cb; }
  function onOpponentJoined(cb) { _cbOpponentJoined = cb; }
  function onOpponentLeft(cb) { _cbOpponentLeft = cb; }
  function onResign(cb) { _cbResign = cb; }
  function onRematchAccepted(cb) { _cbRematchAccepted = cb; }
  function onConnectionChange(cb) { _cbConnectionChange = cb; }
  function onOpponentHeartbeat(cb) { _cbOpponentHeartbeat = cb; }
  function isConnected() { return _connected; }

  // ---------- Resign + Rematch ----------
  async function sendResign() {
    if (!_roomRef || !_myColor) throw new Error('Not in a room');
    await _roomRef.child('resign').set(_myColor);
    await _roomRef.child('status').set('ended');
  }

  async function sendRematchRequest() {
    if (!_roomRef || !_myColor) throw new Error('Not in a room');
    await _roomRef.child('rematch/' + _myColor).set(true);
  }

  // ---------- Listener attachment ----------
  function _attachListeners() {
    _detachListeners(); // defense: never double-attach

    // Moves: child_added fires for every existing child when first attached,
    // but we use _lastSeq to skip anything we already applied during the
    // initial snapshot. Our own echoes are filtered by `author`.
    const movesCb = (snap) => {
      const mv = snap.val();
      if (!mv) return;
      const seq = parseInt(snap.key, 10);
      if (Number.isNaN(seq)) return;
      if (seq <= _lastSeq) return;           // already applied
      if (mv.author === _myColor) {           // our own echo
        _lastSeq = Math.max(_lastSeq, seq);
        return;
      }
      _lastSeq = seq;
      if (_cbMoveReceived) _cbMoveReceived(mv);
    };
    _movesRef.on('child_added', movesCb);
    _handles.push(['moves_child_added', movesCb]);

    // Opponent slot changes (joined / left / heartbeat)
    const otherSlot = _myColor === 'w' ? 'guest' : 'host';
    const otherRef = _roomRef.child(otherSlot);
    const otherCb = (snap) => {
      const data = snap.val();
      if (!data) return;
      const newName = data.name || '';
      if (newName && newName !== _opponentName) {
        _opponentName = newName;
        if (_cbOpponentJoined) _cbOpponentJoined(_opponentName);
      }
      if (data.online === false && _cbOpponentLeft) {
        _cbOpponentLeft('disconnect');
      }
      if (data.lastSeen && _cbOpponentHeartbeat) {
        _cbOpponentHeartbeat(data.lastSeen);
      }
    };
    otherRef.on('value', otherCb);
    _handles.push(['other_value', otherCb]);

    // Resign
    const resignRef = _roomRef.child('resign');
    const resignCb = (snap) => {
      const resigner = snap.val();
      if (resigner && _cbResign) {
        const winner = resigner === 'w' ? 'b' : 'w';
        _cbResign(winner);
      }
    };
    resignRef.on('value', resignCb);
    _handles.push(['resign_value', resignCb]);

    // Rematch — fires when BOTH slots are true
    const rematchRef = _roomRef.child('rematch');
    const rematchCb = async (snap) => {
      const r = snap.val();
      if (!r) return;
      if (r.w && r.b) {
        // Only the host writes the reset to avoid a race
        if (_myColor === 'w') {
          try {
            await _roomRef.child('moves').set(null);
            await _roomRef.child('rematch').set({ w: false, b: false });
            await _roomRef.child('resign').set(null);
            await _roomRef.child('status').set('playing');
          } catch (e) { console.warn('Rematch reset write failed', e); }
        }
        _lastSeq = -1;
        if (_cbRematchAccepted) _cbRematchAccepted();
      }
    };
    rematchRef.on('value', rematchCb);
    _handles.push(['rematch_value', rematchCb]);
  }

  function _detachListeners() {
    if (!_roomRef) { _handles = []; return; }
    try {
      _roomRef.child('moves').off('child_added');
      _roomRef.child(_myColor === 'w' ? 'guest' : 'host').off('value');
      _roomRef.child('resign').off('value');
      _roomRef.child('rematch').off('value');
    } catch (e) { }
    _handles = [];
  }

  // ---------- Public API ----------
  window.NetClient = {
    init,
    isConfigured,
    getMyColor: () => _myColor,
    getRoomCode: () => _roomCode,
    getOpponentName: () => _opponentName,
    getSavedName,
    setSavedName,
    getSavedResume,
    clearResume,

    createRoom,
    joinRoom,
    resumeRoom,
    leaveRoom,      // soft: keeps resume entry (Menu button)
    abandonRoom,    // hard: clears resume entry (Resign, Game Over, fresh Create/Join)

    sendMove,
    onMoveReceived,
    onOpponentJoined,
    onOpponentLeft,
    onOpponentHeartbeat,

    sendResign,
    onResign,
    sendRematchRequest,
    onRematchAccepted,

    // Connection + presence
    onConnectionChange,
    isConnected,
    refreshPresence,
  };
})();
