(() => {
  "use strict";

  // ======= 基本設定（9路） =======
  const N = 9;
  const KOMI = 3.75;

  const EMPTY = 0, BLACK = 1, WHITE = 2;

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const turnBadge = document.getElementById("turnBadge");
  const koBadge = document.getElementById("koBadge");
  const capStat = document.getElementById("capStat");
  const moveStat = document.getElementById("moveStat");
  const statusEl = document.getElementById("status");

  const scoreTerrB = document.getElementById("scoreTerrB");
  const scoreTerrW = document.getElementById("scoreTerrW");
  const scoreResult = document.getElementById("scoreResult");

  const btnPass = document.getElementById("btnPass");
  const btnRestart = document.getElementById("btnRestart");
  const btnResign = document.getElementById("btnResign");

  const gameModeSel = document.getElementById("gameMode");
  const aiLevelSel = document.getElementById("aiLevel");

  const floatingMsg = document.getElementById("floatingMsg");
  let passBlack = 0;
  let passWhite = 0;
  let lastWasPass = false;
  let hoverPoint = null;
  let lastMovePoint = null;


  let territoryMap = null;
  const btnScore = document.getElementById("btnScore");



  // 9路星位： (2,2) (2,6) (6,2) (6,6)；天元：(4,4)
  const STAR_POINTS = [
    [2,2],[2,6],
    [4,4],
    [6,2],[6,6]
  ];

  // ======= 狀態 =======
  let board, toPlay, koPoint, captures, moveCount, passCount, gameOver;
  let history = [];

  function resetGame() {
    board = Array.from({ length: N }, () => Array(N).fill(EMPTY));
    toPlay = BLACK;
    koPoint = null;
    captures = { B: 0, W: 0 };
    moveCount = 0;
    passCount = 0;
    gameOver = false;
    history = [];
    scoreResult.textContent = "—";
    scoreTerrB.textContent = "0";
    scoreTerrW.textContent = "0";
    passBlack = 0;
    passWhite = 0;
    lastWasPass = false;
    document.getElementById("passBlack").textContent = "0";
    document.getElementById("passWhite").textContent = "0";

    updateUI();
    draw();
    maybeAIMove();
  }

  // ======= 工具 =======
  function inBounds(x,y){ return x>=0 && x<N && y>=0 && y<N; }
  function opp(c){ return c===BLACK ? WHITE : (c===WHITE ? BLACK : EMPTY); }
  function key(x,y){ return `${x},${y}`; }
  function cloneBoard(b){ return b.map(r => r.slice()); }
  function boardHash(b){return b.map(r => r.join("")).join("|");}


  function showMsg(text, ms=900){
    floatingMsg.textContent = text;
    floatingMsg.classList.remove("hidden");
    setTimeout(() => floatingMsg.classList.add("hidden"), ms);
  }

  function neighbors4(x,y){
    const r = [];
    if(y-1>=0) r.push([x,y-1]);
    if(x+1<N)  r.push([x+1,y]);
    if(y+1<N)  r.push([x,y+1]);
    if(x-1>=0) r.push([x-1,y]);
    return r;
  }

  // 找群組 + 氣
  function getGroupAndLiberties(b, sx, sy){
    const color = b[sy][sx];
    const stack = [[sx,sy]];
    const visited = new Set([key(sx,sy)]);
    const stones = [];
    const liberties = new Set();

    while(stack.length){
      const [x,y] = stack.pop();
      stones.push([x,y]);
      for(const [nx,ny] of neighbors4(x,y)){
        const v = b[ny][nx];
        if(v === EMPTY) liberties.add(key(nx,ny));
        else if(v === color){
          const k = key(nx,ny);
          if(!visited.has(k)){
            visited.add(k);
            stack.push([nx,ny]);
          }
        }
      }
    }
    return { stones, libertiesCount: liberties.size, liberties };
  }

  function removeStones(b, stones){
    function flashCapture(stones){
  ctx.save();
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 6;
  stones.forEach(([x,y])=>{
    const pad=70, size=Math.min(canvas.width,canvas.height)-pad*2;
    const cell=size/(N-1);
    const cx=pad+x*cell, cy=pad+y*cell;
    ctx.beginPath();
    ctx.arc(cx,cy,cell*0.45,0,Math.PI*2);
    ctx.stroke();
  });
  ctx.restore();
}

    for(const [x,y] of stones) b[y][x] = EMPTY;
  }

  // ======= 規則：落子 / 提子 / 自殺 / Ko =======
  function tryPlayMove(x,y, color, b = board, allowCommit = true){
    if(gameOver) return { ok:false, reason:"已終局" };
    // 🚫 禁止填自己真眼（終局判定關鍵）
if(b[y][x] === EMPTY && isTrueEye(b, x, y, color)){
  return { ok:false, reason:"禁著點（真眼）" };
}

    if(!inBounds(x,y)) return { ok:false, reason:"越界" };
    if(b[y][x] !== EMPTY) return { ok:false, reason:"此處已有棋子" };
    if(koPoint && koPoint.x===x && koPoint.y===y) return { ok:false, reason:"劫（Ko）禁止立即回提" };

    const next = cloneBoard(b);
    next[y][x] = color;

    // 先提對方
    let totalCaptured = 0;
    let capturedStones = [];
    for(const [nx,ny] of neighbors4(x,y)){
      if(next[ny][nx] === opp(color)){
        const g = getGroupAndLiberties(next, nx, ny);
        if(g.libertiesCount === 0){
          totalCaptured += g.stones.length;
          capturedStones = capturedStones.concat(g.stones);
          removeStones(next, g.stones);
        }
      }
    }
    
        // 🔥 超級劫規則（盤面重複禁止）
    const h = boardHash(next);
    if(history.some(s => boardHash(s.board) === h)){
      return { ok:false, reason:"禁著手（重複盤面／劫）" };
    }

    // 再檢查自殺
    const myGroup = getGroupAndLiberties(next, x, y);
    if(myGroup.libertiesCount === 0 && totalCaptured === 0){
      return { ok:false, reason:"禁自殺（除非同時提子）" };
    }

    // 簡易 Ko：只提 1 子且自己群=單子 -> 設 Ko 點為被提之處
    // 正確 Ko 規則
    let newKo = null;
    if(totalCaptured === 1 && myGroup.libertiesCount === 1){
      const [cx,cy] = capturedStones[0];
      newKo = { x: cx, y: cy };
    }


    if(allowCommit){
      history.push({
        board: cloneBoard(board),
        toPlay,
        koPoint: koPoint ? { ...koPoint } : null,
        captures: { ...captures },
        moveCount,
        passCount,
        gameOver
      });

      board = next;
      lastMovePoint = { x, y };
      koPoint = newKo;
      toPlay = opp(color);
      moveCount++;
      passCount = 0;

      if(totalCaptured > 0){
        if(color === BLACK) captures.B += totalCaptured;
        else captures.W += totalCaptured;
      }
      
      lastWasPass = false;

      if(!hasLegalMove(toPlay)){
  if(!hasLegalMove(color)){
    // 🔒 雙方都無合法棋 → 直接終局計分
    gameOver = true;
    statusEl.textContent = "終局（雙方無合法棋）";
    computeAndShowScore();
    showMsg("盤面封閉，自動結算", 1600);
    updateUI();
    draw();
    return;
  }
  showMsg("無合法棋，自動讓子");
  autoPass();
}



      updateUI();
      draw();
      maybeAIMove();
    }

    return { ok:true, nextBoard: next, captured: totalCaptured, ko: newKo, myLib: myGroup.libertiesCount };
  }

  // ======= 計地（簡易） =======
  function computeTerritory(b){
    const visited = Array.from({ length: N }, () => Array(N).fill(false));
    let terrB = 0, terrW = 0;

    function bfs(sx,sy){
      const q = [[sx,sy]];
      visited[sy][sx] = true;
      const empties = [];
      let infB = 0, infW = 0;

      while(q.length){
        const [x,y] = q.shift();
        empties.push([x,y]);

        for(const [nx,ny] of neighbors4(x,y)){
          const v = b[ny][nx];
          if(v === EMPTY && !visited[ny][nx]){
            visited[ny][nx] = true;
            q.push([nx,ny]);
          }
          if(v === BLACK) infB++;
          if(v === WHITE) infW++;
        }
      }

      if(infB > infW) terrB += empties.length;
      else if(infW > infB) terrW += empties.length;
    }

    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(b[y][x] === EMPTY && !visited[y][x]){
          bfs(x,y);
        }
      }
    }
    return { terrB, terrW };
  }

  function computeAndShowScore(){
  territoryMap = Array.from({length:N},()=>Array(N).fill(EMPTY));

  removeDeadStones();
  draw();

  const visited = Array.from({ length:N },()=>Array(N).fill(false));
  let terrB = 0, terrW = 0;

  function bfs(sx,sy){
    const q=[[sx,sy]];
    visited[sy][sx]=true;
    const empties=[];
    let infB=0, infW=0;

    while(q.length){
      const [x,y]=q.shift();
      empties.push([x,y]);
      for(const [nx,ny] of neighbors4(x,y)){
        const v=board[ny][nx];
        if(v===EMPTY && !visited[ny][nx]){
          visited[ny][nx]=true;
          q.push([nx,ny]);
        }
        if(v===BLACK) infB++;
        if(v===WHITE) infW++;
      }
    }

    if(infB>infW){
      terrB+=empties.length;
      empties.forEach(([x,y])=>territoryMap[y][x]=BLACK);
    }else if(infW>infB){
      terrW+=empties.length;
      empties.forEach(([x,y])=>territoryMap[y][x]=WHITE);
    }
  }

  for(let y=0;y<N;y++)
    for(let x=0;x<N;x++)
      if(board[y][x]===EMPTY && !visited[y][x]) bfs(x,y);

  scoreTerrB.textContent=terrB;
  scoreTerrW.textContent=terrW;

  const bTotal = terrB + captures.B;
  const wTotal = terrW + captures.W + KOMI;

  const diff = wTotal - bTotal;
  if(diff>0) scoreResult.textContent=`白勝 ${diff.toFixed(2)}`;
  else scoreResult.textContent=`黑勝 ${(-diff).toFixed(2)}`;
}



  // ======= UI =======
  function updateUI(){
    turnBadge.textContent = `輪到：${toPlay===BLACK ? "黑" : "白"}`;
    koBadge.textContent = koPoint ? `劫：(${koPoint.x+1}, ${koPoint.y+1})` : "劫：無";
    capStat.textContent = `${captures.B} / ${captures.W}`;
    moveStat.textContent = String(moveCount);
    if(!gameOver && passCount === 0) statusEl.textContent = "進行中";
    if(gameOver) statusEl.textContent = "終局";
    document.getElementById("passBlack").textContent = passBlack;
    document.getElementById("passWhite").textContent = passWhite;
    // 🔒 若盤面已封閉，立即結算
if(!gameOver){
  if(!hasLegalMove(BLACK) && !hasLegalMove(WHITE)){
    gameOver = true;
    statusEl.textContent = "終局（盤面封閉）";
    computeAndShowScore();
    showMsg("盤面封閉，自動結算", 1600);
  }
}

  }

  // ======= 繪圖 =======
  function draw(){
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);

    const pad = 70; // 9路棋盤留大一點邊更好點
    const size = Math.min(W,H) - pad*2;
    const cell = size / (N-1);

    // wood
    ctx.save();
    ctx.fillStyle = "rgba(211,167,110,0.55)";
    ctx.fillRect(0,0,W,H);
    ctx.restore();

    // grid
    ctx.save();
    ctx.strokeStyle = "rgba(20,20,20,0.75)";
    ctx.lineWidth = 2;
    for(let i=0;i<N;i++){
      const x = pad + i*cell;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + (N-1)*cell);
      ctx.stroke();

      const y = pad + i*cell;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + (N-1)*cell, y);
      ctx.stroke();
    }
    ctx.restore();

    // stars
    ctx.save();
    ctx.fillStyle = "rgba(15,15,15,0.85)";
    for(const [sx,sy] of STAR_POINTS){
      const cx = pad + sx*cell;
      const cy = pad + sy*cell;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.6, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    // stones
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const v = board[y][x];
        if(v === EMPTY) continue;

        const cx = pad + x*cell;
        const cy = pad + y*cell;
        const r = cell*0.46;

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.arc(cx+2, cy+3, r, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();

        const grad = ctx.createRadialGradient(cx - r*0.35, cy - r*0.35, r*0.2, cx, cy, r*1.2);
        if(v === BLACK){
          grad.addColorStop(0, "rgba(90,90,90,1)");
          grad.addColorStop(0.5, "rgba(20,20,20,1)");
          grad.addColorStop(1, "rgba(0,0,0,1)");
        } else {
          grad.addColorStop(0, "rgba(255,255,255,1)");
          grad.addColorStop(0.6, "rgba(235,235,235,1)");
          grad.addColorStop(1, "rgba(210,210,210,1)");
        }
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Ko mark
    if(koPoint && !gameOver){
      const cx = pad + koPoint.x*cell;
      const cy = pad + koPoint.y*cell;
      ctx.save();
      ctx.strokeStyle = "rgba(255,60,60,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, cell*0.22, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    
    // Ko 禁卓點標記
if(koPoint && !gameOver){
  const cx = pad + koPoint.x * cell;
  const cy = pad + koPoint.y * cell;

  ctx.save();
  ctx.strokeStyle = "rgba(255,60,60,0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - cell*0.25, cy - cell*0.25);
  ctx.lineTo(cx + cell*0.25, cy + cell*0.25);
  ctx.moveTo(cx + cell*0.25, cy - cell*0.25);
  ctx.lineTo(cx - cell*0.25, cy + cell*0.25);
  ctx.stroke();
  ctx.restore();
}
    // ===== 禁著點顯示（Super-Ko / 自殺 / 佔據） =====
if(!gameOver){
  ctx.save();
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 3;

  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      if(board[y][x] !== EMPTY) continue;

      const r = tryPlayMove(x,y,toPlay,board,false);
      if(!r.ok){
        const cx = pad + x*cell;
        const cy = pad + y*cell;
        ctx.beginPath();
        ctx.moveTo(cx - cell*0.25, cy - cell*0.25);
        ctx.lineTo(cx + cell*0.25, cy + cell*0.25);
        ctx.moveTo(cx + cell*0.25, cy - cell*0.25);
        ctx.lineTo(cx - cell*0.25, cy + cell*0.25);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
// 👻 Hover 預覽棋子
if(hoverPoint && !gameOver){
  const {x,y} = hoverPoint;
  if(board[y][x] === EMPTY){
    const r = tryPlayMove(x,y,toPlay,board,false);
    if(r.ok){
      const cx = pad + x*cell;
      const cy = pad + y*cell;
      const rr = cell*0.46;

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.fillStyle = (toPlay===BLACK) ? "#000" : "#fff";
      ctx.arc(cx, cy, rr, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }
}

    // 🎯 最後一手標記
if(lastMovePoint){
  const {x,y} = lastMovePoint;
  const cx = pad + x*cell;
  const cy = pad + y*cell;

  ctx.save();
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, cell*0.22, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

// 🟦🟨 領地上色（僅結算時）
if(gameOver && territoryMap){
  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      const owner = territoryMap[y][x];
      if(owner===EMPTY) continue;

      const cx = pad + x*cell;
      const cy = pad + y*cell;
      const r = cell*0.32;

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = owner===BLACK ? "#000" : "#fff";
      ctx.beginPath();
      ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }
}

  }

  function canvasToBoardXY(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    const pad = 70;
    const size = Math.min(canvas.width, canvas.height) - pad*2;
    const cell = size / (N-1);

    const bx = Math.round((x - pad) / cell);
    const by = Math.round((y - pad) / cell);
    if(!inBounds(bx,by)) return null;

    const cx = pad + bx*cell;
    const cy = pad + by*cell;
    const dx = x - cx, dy = y - cy;
    if(dx*dx + dy*dy > (cell*0.35)*(cell*0.35)) return null;

    return { x: bx, y: by };
  }

  // ======= 人機對弈控制 =======
  function aiEnabled(){
    return gameModeSel.value === "AI";
  }
  function aiColor(){
    return WHITE; // AI 永遠執白，玩家黑先
  }

  function maybeAIMove(){
    if(!hasLegalMove(toPlay)){
      showMsg("AI 無合法棋，自動讓子");
      autoPass();
      return;
    }

    if(!aiEnabled()) return;
    if(gameOver) return;
    if(toPlay !== aiColor()) return;

    setTimeout(() => {
      const lvl = Number(aiLevelSel.value);
      const m = aiChooseMoveFast(lvl);
      if(!m){
        showMsg("AI Pass");
        pass();
        return;
      }
      const res = tryPlayMove(m.x, m.y, toPlay, board, true);
      if(!res.ok){
        console.warn("AI illegal? -> pass", res.reason, m);
        pass();
      }
    }, 60);
  }

  // ======= 快速 AI =======
  function aiChooseMoveFast(level){
    const color = toPlay;
    const legal = listLegalMoves(color);
    if(legal.length === 0) return null;

    // 開局偏好：星位/天元（9路）
    if(moveCount < 2){
      const stars = legal.filter(m => STAR_POINTS.some(([sx,sy]) => m.x===sx && m.y===sy));
      if(stars.length) return stars[(Math.random()*stars.length)|0];
      const center = legal.find(m => m.x===4 && m.y===4);
      if(center) return center;
    }

    const k = (level === 1) ? 40 : 90;
    const candidates = pickCandidates(legal, k);

    let best = null;
    let bestScore = -1e18;

    for(const m of candidates){
      const r = tryPlayMove(m.x, m.y, color, board, false);
      if(!r.ok) continue;

      const s = scoreMoveHeuristic(m.x, m.y, color, r, level);
      if(s > bestScore){
        bestScore = s;
        best = m;
      }
    }
    return best || legal[(Math.random()*legal.length)|0];
  }

  function listLegalMoves(color){
    const moves = [];
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(board[y][x] !== EMPTY) continue;
        if(koPoint && koPoint.x===x && koPoint.y===y) continue;
        const r = tryPlayMove(x,y,color,board,false);
        if(r.ok) moves.push({x,y});
      }
    }
    return moves;
  }

  function pickCandidates(legal, k){
    const scored = legal.map(m => ({ m, s: cheapPosScore(m.x, m.y) }));
    scored.sort((a,b) => b.s - a.s);
    return scored.slice(0, Math.min(k, scored.length)).map(o => o.m);
  }

  function cheapPosScore(x,y){
    const edgeDist = Math.min(x, y, (N-1-x), (N-1-y));
    let s = edgeDist * 0.6;

    if(moveCount < 20){
      for(const [sx,sy] of STAR_POINTS){
        const d = Math.abs(x-sx) + Math.abs(y-sy);
        if(d === 0) s += 8;
        else if(d === 1) s += 4;
        else if(d === 2) s += 2;
      }
      if(x===4 && y===4) s += 3;
    }

    if(moveCount > 40) s += (edgeDist === 0 ? 1.0 : 0);
    return s;
  }

  function scoreMoveHeuristic(x,y,color,simResult, level){
    const next = simResult.nextBoard;
    const captured = simResult.captured || 0;

    let score = 0;

    // 1) 直接提子
    score += captured * 100;

    // 2) 自己氣數
    const myLib = simResult.myLib ?? getGroupAndLiberties(next, x, y).libertiesCount;
    if(myLib === 1) score -= 35;
    else if(myLib === 2) score -= 10;
    else score += Math.min(10, myLib * 1.2);

    // 3) 壓對方氣
    for(const [nx,ny] of neighbors4(x,y)){
      if(next[ny][nx] === opp(color)){
        const g = getGroupAndLiberties(next, nx, ny);
        if(g.libertiesCount === 1) score += 28;
        else if(g.libertiesCount === 2) score += 9;
      }
    }

    // 4) 連接
    let friendlyAdj = 0;
    for(const [nx,ny] of neighbors4(x,y)){
      if(next[ny][nx] === color) friendlyAdj++;
    }
    score += friendlyAdj * 6;

    // 5) 開局貼邊稍扣
    if(moveCount < 14){
      const edgeDist = Math.min(x, y, (N-1-x), (N-1-y));
      if(edgeDist === 0) score -= 6;
    }

    // 6) Ko 小加分
    if(simResult.ko) score += 8;

    // 7) 後半盤用簡易計地差做 tie-break
    if(levelWantEval()){
      const t = computeTerritory(next);
      const bTotal = t.terrB;
      const wTotal = t.terrW + KOMI;
      const diff = (color === BLACK) ? (bTotal - wTotal) : (wTotal - bTotal);
      score += diff * (level === 1 ? 0.22 : 0.35);
    }

    // 8) 團塊過密懲罰
    const group = getGroupAndLiberties(next, x, y);
    if(group.stones.length > 5) score -= (group.stones.length - 5) * 12;

    // 9) 開局偏好星位/天元（9路）
    if(moveCount <= 25){
      for(const [sx,sy] of STAR_POINTS){
        const d = Math.abs(x-sx) + Math.abs(y-sy);
        if(d === 0) score += 12;
        else if(d === 1) score += 6;
      }
      if(x===4 && y===4) score += 5;
      // 禁止太早靠邊縮角
      const edge = Math.min(x, y, (N-1-x), (N-1-y));
      if(edge === 0) score -= 20;
    }

    return score;
  }

  function levelWantEval(){
    return moveCount >= 30 && moveCount <= 120;
  }

  // ======= 事件 =======
  canvas.addEventListener("click", (ev) => {
    if(gameOver) return showMsg("已終局：可重新開始");
    if(aiEnabled() && toPlay === WHITE) return showMsg("等 AI 下完");

    const p = canvasToBoardXY(ev.clientX, ev.clientY);
    if(!p) return;
    
    if(koPoint && p && koPoint.x===p.x && koPoint.y===p.y){
  return showMsg("這是禁卓點（Ko）");
}


    const res = tryPlayMove(p.x, p.y, toPlay, board, true);
    if(!res.ok) showMsg(res.reason, 1100);
  });

  btnPass.onclick = () => autoPass();

  btnResign.addEventListener("click", () => {
    if(gameOver) return;

    gameOver = true;
    const loser = toPlay;
    const winner = opp(loser);

    statusEl.textContent = (winner === BLACK ? "黑" : "白") + "勝（對手投降）";
    scoreResult.textContent = (winner === BLACK ? "黑勝" : "白勝") + "（對手投降）";
    showMsg("對手投降，對局結束");
    updateUI();
    draw();
  });

  canvas.addEventListener("mousemove", ev => {
  if(gameOver) return;
  const p = canvasToBoardXY(ev.clientX, ev.clientY);
  hoverPoint = p;
  draw();
});

canvas.addEventListener("mouseleave", () => {
  hoverPoint = null;
  draw();
});

  
  btnRestart.addEventListener("click", () => resetGame());

  aiLevelSel.addEventListener("change", () => {
    if(!gameOver){
      showMsg(aiEnabled() ? "AI 已開啟" : "AI 已關閉");
      maybeAIMove();
    }
  });

  gameModeSel.addEventListener("change", () => resetGame());
    
  // ======= 進階形狀導向 AI（來自 NineBoardGo） =======
function shapeScore(board, x, y, color){
    let score = 0;

    // 星位
    if ((x===2||x===6) && (y===2||y===6)) score += 10;
    if ((x===0||x===8) && (y===0||y===8)) score += 8;
    if (x===0||x===8||y===0||y===8) score += 5;

    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

    // 靠近對方棋
    for(const [dx,dy] of dirs){
        const nx=x+dx, ny=y+dy;
        if(nx>=0&&nx<9&&ny>=0&&ny<9 && board[ny][nx]===opp(color)) score += 3;
        if(nx>=0&&nx<9&&ny>=0&&ny<9 && board[ny][nx]===EMPTY) score += 1;
    }
    return score;
}
  
function autoPass(){
  if(gameOver) return;

  const loser = toPlay;
  const winner = opp(loser);

  if(loser === BLACK){
    passBlack++; 
    document.getElementById("passBlack").textContent = passBlack;
    if(passBlack >= 2){
      gameOver = true;
      statusEl.textContent = "終局（黑方讓子達 2 次）";
      scoreResult.textContent = "白勝（黑方讓子過多）";
      showMsg("黑方讓子 2 次，白方勝利", 1600);
      return;
    }
  } else {
    passWhite++;
    document.getElementById("passWhite").textContent = passWhite;
    if(passWhite >= 2){
      gameOver = true;
      statusEl.textContent = "終局（白方讓子達 2 次）";
      scoreResult.textContent = "黑勝（白方讓子過多）";
      showMsg("白方讓子 2 次，黑方勝利", 1600);
      return;
    }
  }

  // 雙方連續讓子也會終局
  if(lastWasPass){
    gameOver = true;
    statusEl.textContent = "終局（雙方連續讓子）";
    computeAndShowScore();
    return;
  }

  lastWasPass = true;
  toPlay = opp(toPlay);
  moveCount++;
  updateUI();
  draw();
  maybeAIMove();
}


function hasLegalMove(color){
  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      if(board[y][x] !== EMPTY) continue;

      // 嘗試下
      const r = tryPlayMove(x,y,color,board,false);
      if(!r.ok) continue;
      
      // 🚫 禁止填自己眼
      if(isTrueEye(board, x, y, color)) continue;

      // ⚠️ 若這步下完對方也無合法棋，代表是填眼 → 不算合法
      if(!hasLegalMoveAfter(r.nextBoard, opp(color))) continue;

      return true;
    }
  }
  return false;
}

  function hasLegalMoveAfter(b, color){
  for(let y=0;y<N;y++)
    for(let x=0;x<N;x++){
      if(b[y][x] !== EMPTY) continue;
      if(tryPlayMove(x,y,color,b,false).ok) return true;
    }
  return false;
}

function isTrueEye(b, x, y, color){
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for(const [dx,dy] of dirs){
    const nx=x+dx, ny=y+dy;
    if(nx<0||nx>=N||ny<0||ny>=N) return false;
    if(b[ny][nx] !== color) return false;
  }
  return true;
}

  function removeDeadStones(){
  let removed = true;
  while(removed){
    removed = false;
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const c = board[y][x];
        if(c === EMPTY) continue;
        const g = getGroupAndLiberties(board, x, y);
        if(g.libertiesCount <= 1){
          removeStones(board, g.stones);
          if(c === BLACK) captures.W += g.stones.length;
          else captures.B += g.stones.length;
          removed = true;
        }
      }
    }
  }
}
  
btnScore.addEventListener("click", () => {
  if(gameOver) return;

  gameOver = true;
  statusEl.textContent = "終局（手動結算）";
  computeAndShowScore();
  showMsg("已進入結算模式", 1400);
  updateUI();
  draw();
});


  
  // ======= 啟動 =======
  resetGame();
})();
