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
  let _lastSeq = -1;
  let _initialized = false;

  // Listener handles so we can detach cleanly on leaveRoom
  let _handles = [];

  // User-provided callbacks
  let _cbMoveReceived = null;
  let _cbOpponentJoined = null;
  let _cbOpponentLeft = null;
  let _cbResign = null;
  let _cbRematchAccepted = null;

  // ---------- Constants ----------
  const NAME_KEY = 'zledaChess.playerName';
  const RESUME_KEY = 'zledaChess.resume';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/I/1
  const CODE_LEN = 5;
  const NAME_MAX = 16;

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

  function getSavedResume() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveResume(obj) {
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(obj)); } catch (e) { }
  }
  function clearResume() {
    try { sessionStorage.removeItem(RESUME_KEY); } catch (e) { }
  }

  // ---------- Firebase init ----------
  function init() {
    if (_initialized) return true;
    if (!isConfigured()) {
      console.warn('[NetClient] Firebase not configured — edit net.js FIREBASE_CONFIG to enable online play.');
      return false;
    }
    if (typeof firebase === 'undefined') {
      console.error('[NetClient] Firebase SDK not loaded. Check <script> tags in index.html.');
      return false;
    }
    try {
      if (firebase.apps && firebase.apps.length === 0) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      _db = firebase.database();
      _initialized = true;
      return true;
    } catch (e) {
      console.error('[NetClient] init failed:', e);
      return false;
    }
  }

  // ---------- Room lifecycle ----------
  async function createRoom(name) {
    if (!init()) throw new Error('Firebase not configured');
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
      status: 'waiting',
      host: { clientId: _clientId, online: true, name: myName },
      guest: { clientId: '', online: false, name: '' },
      resign: null,
      rematch: { w: false, b: false },
    });

    // onDisconnect cleanup — fires server-side when our TCP drops
    _roomRef.child('host/online').onDisconnect().set(false);

    saveResume({ code, myColor: 'w', clientId: _clientId, name: myName });
    _attachListeners();
    return { code, myColor: 'w', myName };
  }

  async function joinRoom(code, name) {
    if (!init()) throw new Error('Firebase not configured');
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
    });
    await _roomRef.child('status').set('playing');
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
    return {
      myColor: 'b',
      myName,
      opponentName: _opponentName,
      existingMoves,
      status: 'playing',
    };
  }

  async function resumeRoom(code) {
    if (!init()) throw new Error('Firebase not configured');
    const saved = getSavedResume();
    if (!saved || saved.code !== code) throw new Error('No resume data for ' + code);

    const snap = await _db.ref('rooms/' + code).once('value');
    const room = snap.val();
    if (!room) { clearResume(); throw new Error('Room expired'); }
    if (room.status === 'ended') { clearResume(); throw new Error('Room already ended'); }

    const slot = saved.myColor === 'w' ? 'host' : 'guest';
    if (!room[slot] || room[slot].clientId !== saved.clientId) {
      clearResume();
      throw new Error('Slot no longer belongs to you — join as a new player');
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

    // Mark ourselves back online
    await _roomRef.child(slot + '/online').set(true);
    _roomRef.child(slot + '/online').onDisconnect().set(false);

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
    return {
      myColor: _myColor,
      myName: _myName,
      opponentName: _opponentName,
      existingMoves,
      status: room.status,
    };
  }

  function leaveRoom() {
    _detachListeners();
    if (_roomRef && _myColor) {
      const slot = _myColor === 'w' ? 'host' : 'guest';
      try { _roomRef.child(slot + '/online').set(false); } catch (e) { }
    }
    clearResume();
    _roomRef = null;
    _movesRef = null;
    _roomCode = null;
    _myColor = null;
    _myName = null;
    _opponentName = null;
    _clientId = null;
    _lastSeq = -1;
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
  }

  function onMoveReceived(cb) { _cbMoveReceived = cb; }
  function onOpponentJoined(cb) { _cbOpponentJoined = cb; }
  function onOpponentLeft(cb) { _cbOpponentLeft = cb; }
  function onResign(cb) { _cbResign = cb; }
  function onRematchAccepted(cb) { _cbRematchAccepted = cb; }

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

    // Opponent slot changes (joined / left)
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
    leaveRoom,

    sendMove,
    onMoveReceived,
    onOpponentJoined,
    onOpponentLeft,

    sendResign,
    onResign,
    sendRematchRequest,
    onRematchAccepted,
  };
})();
