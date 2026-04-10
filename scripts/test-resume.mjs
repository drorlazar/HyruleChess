// ============================================================
// Resume / Reconnect test suite for Hyrule Chess
// ============================================================
//
// Runs 8 scenarios against the local dev server, each with two
// isolated browser contexts (separate localStorage + Firebase auth).
//
// Requirements:
//   - Local server: ./run.sh   (serves index.html on :8765)
//   - Firebase Anonymous Auth enabled for the 'hyrulechess' project
//   - node + playwright (run `npm install` first)
//
// Usage:
//   npm run test:resume
//   BASE_URL=https://drorlazar.github.io/HyruleChess/ npm run test:resume
//
// Scenarios:
//   1. Tab refresh mid-game (auto-resume from localStorage)
//   2. Tab close + fresh context reopen (localStorage survives)
//   3. Network offline → online (reconnecting banner, state intact)
//   4. Both players refresh simultaneously
//   5. Long-gap resume (artificially aged savedAt)
//   6. Stale room (server-deleted while client is closed)
//   7. Resign during disconnect (game-over on return)
//   8. Mid-game moves during disconnect (receive all on return)

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/index.html';
const HEADED = process.env.HEADED === '1';
const SLOW_MO = process.env.SLOW === '1' ? 150 : 0;

// ---------- Output helpers ----------
const c = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  bold:  '\x1b[1m',
};
function log(...args) { console.log(...args); }
function pass(name) { log(`  ${c.green}✓${c.reset} ${name}`); }
function fail(name, err) {
  log(`  ${c.red}✗${c.reset} ${name}`);
  log(`    ${c.red}${err && err.message ? err.message : err}${c.reset}`);
  if (err && err.stack) log(c.dim + err.stack.split('\n').slice(1, 4).join('\n') + c.reset);
}
function hdr(msg) { log(`\n${c.bold}${c.cyan}━━ ${msg} ━━${c.reset}`); }

// ---------- Page helpers ----------
async function newPlayer(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log(`  ${c.red}[${name}] pageerror:${c.reset} ${err.message}`));
  await page.goto(BASE_URL);
  // Wait for NetClient + firebase to be ready
  await page.waitForFunction(() => typeof window.NetClient !== 'undefined' && typeof window.firebase !== 'undefined');
  // Make sure autoResume IIFE has a chance to no-op (no saved resume on fresh context)
  await page.waitForTimeout(200);
  return { ctx, page, name };
}

async function createRoom(player, displayName) {
  const code = await player.page.evaluate(async (n) => {
    try { NetClient.clearResume(); } catch {}
    await NetClient.init();
    const { code } = await NetClient.createRoom(n);
    return code;
  }, displayName);
  return code;
}

async function joinRoom(player, code, displayName) {
  const result = await player.page.evaluate(async ({ code, n }) => {
    try { NetClient.clearResume(); } catch {}
    await NetClient.init();
    const result = await NetClient.joinRoom(code, n);
    // Start the local game AND await it so the 3D pieces finish loading
    await startGame('online', {
      myColor: result.myColor,
      myName: n,
      opponentName: result.opponentName,
      resumeMoves: result.existingMoves || [],
    });
    return { myColor: result.myColor, opponentName: result.opponentName };
  }, { code, n: displayName });
  // Belt-and-suspenders: wait for gameActive + piece meshes to be in place
  await player.page.waitForFunction(
    // `gameActive` and `pieceMeshMap` are top-level `let` bindings in the
    // classic <script> block, so they are NOT on `window`. Use bare access.
    () => typeof gameActive !== 'undefined' && gameActive === true &&
          typeof pieceMeshMap !== 'undefined' && Object.keys(pieceMeshMap).length >= 32,
    { timeout: 45000 }
  );
  return result;
}

async function startLocalGameForHost(player, oppName) {
  await player.page.evaluate(async ({ oppName }) => {
    await startGame('online', {
      myColor: 'w',
      myName: (NetClient.getSavedResume() || {}).name || 'Host',
      opponentName: oppName,
    });
  }, { oppName });
  await player.page.waitForFunction(
    // `gameActive` and `pieceMeshMap` are top-level `let` bindings in the
    // classic <script> block, so they are NOT on `window`. Use bare access.
    () => typeof gameActive !== 'undefined' && gameActive === true &&
          typeof pieceMeshMap !== 'undefined' && Object.keys(pieceMeshMap).length >= 32,
    { timeout: 45000 }
  );
}

async function makeMove(player, fr, fc, tr, tc) {
  // Drive the move directly through the Chess engine + NetClient — bypasses
  // the 3D click pipeline which involves raycasting and animation timers.
  await player.page.evaluate(async ({ fr, fc, tr, tc }) => {
    const moves = Chess.legalMoves(fr, fc);
    const m = moves.find(x => x.toRow === tr && x.toCol === tc);
    if (!m) throw new Error('illegal move ' + fr + ',' + fc + '→' + tr + ',' + tc);
    Chess.makeMove(m);
    if (typeof updateUI === 'function') updateUI();
    if (window.NetClient && typeof gameMode !== 'undefined' && gameMode === 'online') {
      await NetClient.sendMove({
        fromRow: m.fromRow, fromCol: m.fromCol,
        toRow: m.toRow, toCol: m.toCol,
        promoteTo: m.promoteTo || null,
      });
    }
  }, { fr, fc, tr, tc });
}

async function getMoveHistory(player) {
  return await player.page.evaluate(() => Chess.getMoveHistory());
}

async function waitForMoves(player, expected, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getMoveHistory(player);
    if (h.length >= expected) return h;
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error(`Timeout waiting for ${expected} moves; got ${(await getMoveHistory(player)).length}`);
}

async function getResumeEntry(player) {
  return await player.page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('zledaChess.resume.v2') || 'null'); } catch { return null; }
  });
}

async function closePlayer(player) {
  try { await player.ctx.close(); } catch {}
}

// ---------- Individual scenarios ----------

async function scenario1_tabRefresh(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await A.page.waitForTimeout(500);
    await startLocalGameForHost(A, 'Bob');

    await makeMove(A, 6, 4, 4, 4); // e4
    await waitForMoves(B, 1);
    await makeMove(B, 1, 4, 3, 4); // e5
    await waitForMoves(A, 2);

    // Refresh tab A — auto-resume should kick in and bring state back
    await A.page.reload();
    await A.page.waitForFunction(() => typeof window.NetClient !== 'undefined');
    // Wait for autoResume to complete (looks for game active or overlay hidden)
    await A.page.waitForFunction(
      () => typeof gameActive !== 'undefined' && gameActive === true,
      { timeout: 15000 }
    );

    const aHistory = await getMoveHistory(A);
    if (aHistory.length !== 2 || aHistory[0] !== 'e4' || aHistory[1] !== 'e5') {
      throw new Error('A move history not restored: ' + JSON.stringify(aHistory));
    }
    pass('1. Tab refresh mid-game: auto-resume restored 2 moves + active game');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

async function scenario2_tabCloseReopen(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');

    await makeMove(A, 6, 3, 4, 3); // d4
    await waitForMoves(B, 1);

    // "Close" A's tab: grab the localStorage snapshot + close the context.
    // To simulate reopening in a new tab but same browser profile, we
    // spin up a new context and seed its localStorage to match.
    const savedResume = await A.page.evaluate(() => localStorage.getItem('zledaChess.resume.v2'));
    const savedName = await A.page.evaluate(() => localStorage.getItem('zledaChess.playerName'));
    await A.ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx2.addInitScript(({ resume, name }) => {
      try { localStorage.setItem('zledaChess.resume.v2', resume); } catch {}
      if (name) try { localStorage.setItem('zledaChess.playerName', name); } catch {}
    }, { resume: savedResume, name: savedName });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE_URL);
    await page2.waitForFunction(() => typeof window.NetClient !== 'undefined');
    await page2.waitForFunction(
      () => typeof gameActive !== 'undefined' && gameActive === true,
      { timeout: 15000 }
    );
    const h = await page2.evaluate(() => Chess.getMoveHistory());
    if (h.length !== 1 || h[0] !== 'd4') {
      throw new Error('Reopened tab history mismatch: ' + JSON.stringify(h));
    }
    pass('2. Tab close + reopen: localStorage persisted + auto-resume into game');
    // Cleanup this context too
    await ctx2.close();
  } finally {
    if (code) await tryDeleteRoom(B, code);
    await closePlayer(B);
  }
}

async function scenario3_networkDrop(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');

    await makeMove(A, 6, 4, 4, 4); // e4
    await waitForMoves(B, 1);

    // Force A offline via Firebase's goOffline (cleaner than ctx.setOffline
    // which would also break the page load). The connection listener should
    // fire and the banner should appear.
    await A.page.evaluate(() => { firebase.database().goOffline(); });
    await A.page.waitForFunction(() => {
      const el = document.getElementById('reconnectBanner');
      return el && el.classList.contains('show');
    }, { timeout: 5000 });

    // Meanwhile B makes a move
    await makeMove(B, 1, 4, 3, 4);
    await B.page.waitForTimeout(500);

    // Bring A back online — banner should clear and A should receive B's move
    await A.page.evaluate(() => { firebase.database().goOnline(); });
    const aHistory = await waitForMoves(A, 2, 7000);
    if (aHistory.length !== 2) throw new Error('A did not receive e5 after reconnect');

    // Banner should no longer be showing (or will clear within 1.5s)
    await A.page.waitForFunction(() => {
      const el = document.getElementById('reconnectBanner');
      return !el || !el.classList.contains('show');
    }, { timeout: 4000 });
    pass('3. Network drop+restore: reconnecting banner fired + missed move received');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

async function scenario4_bothRefresh(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');

    await makeMove(A, 6, 4, 4, 4);
    await waitForMoves(B, 1);
    await makeMove(B, 1, 4, 3, 4);
    await waitForMoves(A, 2);

    // Simultaneous refresh
    await Promise.all([A.page.reload(), B.page.reload()]);
    const gameReady = () => typeof gameActive !== 'undefined' && gameActive === true;
    await Promise.all([
      A.page.waitForFunction(gameReady, { timeout: 15000 }),
      B.page.waitForFunction(gameReady, { timeout: 15000 }),
    ]);
    const [ah, bh] = await Promise.all([getMoveHistory(A), getMoveHistory(B)]);
    if (JSON.stringify(ah) !== JSON.stringify(bh)) {
      throw new Error('Divergent histories: A=' + JSON.stringify(ah) + ' B=' + JSON.stringify(bh));
    }
    if (ah.length !== 2) throw new Error('Expected 2 moves, got ' + ah.length);
    pass('4. Both players refresh simultaneously: histories match');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

async function scenario5_longGapResume(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');
    await makeMove(A, 6, 4, 4, 4);
    await waitForMoves(B, 1);

    // Artificially age A's savedAt by 2 hours
    await A.page.evaluate(() => {
      const raw = localStorage.getItem('zledaChess.resume.v2');
      const obj = JSON.parse(raw);
      obj.savedAt = Date.now() - (2 * 60 * 60 * 1000);
      localStorage.setItem('zledaChess.resume.v2', JSON.stringify(obj));
    });
    await A.page.reload();
    await A.page.waitForFunction(() => typeof window.NetClient !== 'undefined');
    await A.page.waitForFunction(
      () => typeof gameActive !== 'undefined' && gameActive === true,
      { timeout: 15000 }
    );
    const h = await getMoveHistory(A);
    if (h.length !== 1) throw new Error('Long-gap resume lost state: ' + JSON.stringify(h));
    pass('5. Long-gap resume (2h old savedAt): auto-resume still succeeds');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

async function scenario6_staleRoom(browser) {
  const A = await newPlayer(browser, 'A');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    // Delete the room server-side while A still has the resume entry
    await A.page.evaluate((c) => firebase.database().ref('rooms/' + c).remove(), code);
    await A.page.waitForTimeout(500);
    // Reload — autoResume should try, fail gracefully, and clear the entry
    await A.page.reload();
    await A.page.waitForFunction(() => typeof window.NetClient !== 'undefined');
    await A.page.waitForTimeout(2500); // let the overlay show + hide
    const saved = await getResumeEntry(A);
    if (saved) throw new Error('Expected resume entry cleared; found ' + JSON.stringify(saved));
    const active = await A.page.evaluate(() => typeof gameActive !== 'undefined' && gameActive === true);
    if (active) throw new Error('gameActive should be false after failed resume');
    pass('6. Stale room (deleted server-side): graceful fallback + cleared entry');
  } finally {
    await closePlayer(A);
  }
}

async function scenario7_resignDuringDisconnect(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');

    // A drops
    await A.page.evaluate(() => firebase.database().goOffline());
    // B resigns
    await B.page.evaluate(() => NetClient.sendResign());
    await B.page.waitForTimeout(600);
    // A back online — onResign callback should fire and show gameOver
    await A.page.evaluate(() => firebase.database().goOnline());
    await A.page.waitForFunction(() => {
      const go = document.getElementById('gameOver');
      return go && go.classList.contains('visible');
    }, { timeout: 6000 });
    pass('7. Resign during disconnect: returning player sees game-over');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

async function scenario8_multipleMovesDuringDisconnect(browser) {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  let code = null;
  try {
    code = await createRoom(A, 'Alice');
    await joinRoom(B, code, 'Bob');
    await startLocalGameForHost(A, 'Bob');

    // A moves e4 first so it's B's turn
    await makeMove(A, 6, 4, 4, 4);
    await waitForMoves(B, 1);
    // A drops
    await A.page.evaluate(() => firebase.database().goOffline());
    // B plays 3 moves (e5, then A's turn... wait we need alternating)
    // Actually only B can move during A's disconnect, so just one move.
    await makeMove(B, 1, 4, 3, 4);
    await B.page.waitForTimeout(300);
    await A.page.evaluate(() => firebase.database().goOnline());
    await waitForMoves(A, 2, 6000);
    const h = await getMoveHistory(A);
    if (h.length !== 2 || h[1] !== 'e5') throw new Error('Missing moves on reconnect: ' + JSON.stringify(h));
    pass('8. Move during disconnect: delivered on reconnect');
  } finally {
    if (code) await tryDeleteRoom(A, code);
    await closePlayer(A); await closePlayer(B);
  }
}

// Cleanup helper — delete the room via the authed client
async function tryDeleteRoom(player, code) {
  try {
    await player.page.evaluate((c) => firebase.database().ref('rooms/' + c).remove(), code);
  } catch {}
}

// ---------- Runner ----------
async function main() {
  hdr('Hyrule Chess — Resume / Reconnect tests');
  log(c.dim + 'Target: ' + BASE_URL + c.reset);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: SLOW_MO });
  const scenarios = [
    ['scenario1_tabRefresh',                scenario1_tabRefresh],
    ['scenario2_tabCloseReopen',            scenario2_tabCloseReopen],
    ['scenario3_networkDrop',               scenario3_networkDrop],
    ['scenario4_bothRefresh',               scenario4_bothRefresh],
    ['scenario5_longGapResume',             scenario5_longGapResume],
    ['scenario6_staleRoom',                 scenario6_staleRoom],
    ['scenario7_resignDuringDisconnect',    scenario7_resignDuringDisconnect],
    ['scenario8_multipleMovesDuringDisconnect', scenario8_multipleMovesDuringDisconnect],
  ];
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of scenarios) {
    try {
      await fn(browser);
      passed++;
    } catch (e) {
      fail(name, e);
      failed++;
    }
  }
  await browser.close();

  log(`\n${c.bold}Results: ${c.green}${passed} passed${c.reset}${c.bold}, ${failed > 0 ? c.red : c.dim}${failed} failed${c.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  log(c.red + 'Test runner crashed:' + c.reset, e);
  process.exit(2);
});
