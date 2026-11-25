
const sourceCode = document.getElementById("sourceCode");
const lineNumbers = document.getElementById("lineNumbers");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const message = document.getElementById("message");

function updateLineNumbers() {
  const count = Math.max(1, sourceCode.value.split("\n").length);
  lineNumbers.textContent = Array.from(
    { length: count },
    (_, i) => i + 1
  ).join("\n");
}

sourceCode.addEventListener("input", updateLineNumbers);
sourceCode.addEventListener("scroll", () => {
  lineNumbers.scrollTop = sourceCode.scrollTop;
});

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getStatements(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line =>
      line &&
      line !== "{" &&
      line !== "}" &&
      line !== "};"
    );
}

function normalizeExpression(expression) {
  return expression
    .replace(/\s+/g, "")
    .replace(/\b\d+\.0+\b/g, match => String(Number(match)));
}

function simplifyExpression(expression) {
  let result = expression.trim();
  const original = result;

  result = result.replace(/\b(\w+)\s*\+\s*0\b/g, "$1");
  result = result.replace(/\b0\s*\+\s*(\w+)\b/g, "$1");
  result = result.replace(/\b(\w+)\s*\*\s*1\b/g, "$1");
  result = result.replace(/\b1\s*\*\s*(\w+)\b/g, "$1");
  result = result.replace(/\b(\w+)\s*\*\s*0\b/g, "0");
  result = result.replace(/\b0\s*\*\s*(\w+)\b/g, "0");
  result = result.replace(/\b(\w+)\s*-\s*0\b/g, "$1");

  const constantMatch = result.match(
    /^(-?\d+(?:\.\d+)?)\s*([+\-*\/])\s*(-?\d+(?:\.\d+)?)$/
  );

  if (constantMatch) {
    const a = Number(constantMatch[1]);
    const operator = constantMatch[2];
    const b = Number(constantMatch[3]);

    if (!(operator === "/" && b === 0)) {
      let value;

      if (operator === "+") value = a + b;
      if (operator === "-") value = a - b;
      if (operator === "*") value = a * b;
      if (operator === "/") value = a / b;

      if (Number.isFinite(value)) {
        result = String(Number(value.toFixed(8)));
      }
    }
  }

  return {
    result,
    changed: result !== original
  };
}

function isAssignment(statement) {
  return /^[A-Za-z_]\w*\s*=\s*.+;?$/.test(statement) &&
    !/^(if|while|for)\b/.test(statement);
}

function parseAssignment(statement) {
  const match = statement.match(
    /^(?:int|float|double|char|long|short)?\s*([A-Za-z_]\w*)\s*=\s*(.+);?$/
  );

  if (!match) return null;

  return {
    variable: match[1],
    expression: match[2].replace(/;$/, "").trim()
  };
}

function removeType(statement) {
  return statement.replace(
    /^(int|float|double|char|long|short)\s+/,
    ""
  );
}

function createBasicBlocks(statements) {
  const blocks = [];
  let current = [];

  function finishBlock() {
    if (current.length) {
      blocks.push([...current]);
      current = [];
    }
  }

  statements.forEach(statement => {
    const isBranch = /^(if|while|for|switch)\s*\(/.test(statement);
    const isExit = /^(return|break|continue)\b/.test(statement);
    const isLabel = /^[A-Za-z_]\w*\s*:/.test(statement);

    if (isLabel) finishBlock();

    current.push(statement);

    if (isBranch || isExit || isLabel) finishBlock();
  });

  finishBlock();
  return blocks;
}

function optimizeStatements(statements) {
  const optimized = [];
  const explanations = [];
  const expressionTable = new Map();
  const assignedVariables = new Set();
  const variableValues = new Map();
  let optimizationCount = 0;

  statements.forEach(statement => {
    if (!isAssignment(statement)) {
      optimized.push(statement);
      return;
    }

    const assignment = parseAssignment(statement);

    if (!assignment) {
      optimized.push(statement);
      return;
    }

    const variable = assignment.variable;
    let expression = assignment.expression;

    for (const [name, value] of variableValues) {
      const pattern = new RegExp("\\b" + name + "\\b", "g");
      expression = expression.replace(pattern, value);
    }

    const simplified = simplifyExpression(expression);

    if (simplified.changed) {
      explanations.push(
        `Algebraic simplification: ${variable} = ${expression} → ${simplified.result}`
      );
      optimizationCount++;
    }

    expression = simplified.result;

    const key = normalizeExpression(expression);
    const previousVariable = expressionTable.get(key);

    if (previousVariable && /[+\-*/]/.test(expression)) {
      expression = previousVariable;
      explanations.push(
        `Common subexpression elimination: reused ${previousVariable} instead of recalculating ${key}.`
      );
      optimizationCount++;
    } else if (/[+\-*/]/.test(expression)) {
      expressionTable.set(key, variable);
    }

    const isNumber = /^-?\d+(?:\.\d+)?$/.test(expression);

    if (isNumber) {
      variableValues.set(variable, expression);
    } else {
      variableValues.delete(variable);
    }

    assignedVariables.add(variable);

    const declaration = statement.match(
      /^(int|float|double|char|long|short)\s+/
    );

    const prefix = declaration ? declaration[1] + " " : "";

    optimized.push(`${prefix}${variable} = ${expression};`);
  });

  return {
    optimized,
    explanations,
    optimizationCount
  };
}

function renderBlocks(blocks) {
  const container = document.getElementById("blocksOutput");

  if (!blocks.length) {
    container.innerHTML = '<div class="empty-state">No basic blocks found.</div>';
    return;
  }

  container.innerHTML = blocks.map((block, index) => `
    <div class="block-card">
      <div class="block-title">B${index + 1} — Basic Block</div>
      <div class="block-code">${block.map(escapeHTML).join("\n")}</div>
    </div>
  `).join("");
}

function renderCFG(blocks) {
  const container = document.getElementById("cfgOutput");

  if (!blocks.length) {
    container.innerHTML = '<div class="empty-state">No CFG available.</div>';
    return;
  }

  const width = 500;
  const nodeWidth = 160;
  const nodeHeight = 55;
  const gap = 45;
  const height = Math.max(150, blocks.length * (nodeHeight + gap) + 30);
  const center = width / 2;

  let svg = `
    <svg viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Illustrative control flow graph">
      <defs>
        <marker id="cfgArrow" markerWidth="8" markerHeight="8"
          refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="#8494b5"></path>
        </marker>
      </defs>
  `;

  blocks.forEach((block, index) => {
    const y = 15 + index * (nodeHeight + gap);

    if (index < blocks.length - 1) {
      svg += `
        <path class="graph-edge"
          d="M ${center} ${y + nodeHeight}
             L ${center} ${y + nodeHeight + gap - 5}"
          marker-end="url(#cfgArrow)"></path>
      `;
    }

    svg += `
      <rect class="graph-node" x="${center - nodeWidth / 2}"
        y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="9"></rect>
      <text class="graph-node-text" x="${center}" y="${y + 23}"
        text-anchor="middle">Basic Block B${index + 1}</text>
      <text x="${center}" y="${y + 40}" text-anchor="middle"
        fill="#718096" font-size="10">
        ${block.length} statement(s)
      </text>
    `;
  });

  svg += "</svg>";
  container.innerHTML = svg;
}

function renderDAG(statements) {
  const container = document.getElementById("dagOutput");
  const expressions = [];

  statements.forEach(statement => {
    const assignment = parseAssignment(statement);
    if (!assignment) return;

    const match = assignment.expression.match(
      /^([A-Za-z_]\w*|-?\d+(?:\.\d+)?)\s*([+\-*\/])\s*([A-Za-z_]\w*|-?\d+(?:\.\d+)?)$/
    );

    if (match) {
      expressions.push({
        variable: assignment.variable,
        left: match[1],
        operator: match[2],
        right: match[3]
      });
    }
  });

  if (!expressions.length) {
    container.innerHTML =
      '<div class="empty-state">No arithmetic expressions available for DAG.</div>';
    return;
  }

  const width = 600;
  const height = Math.max(180, expressions.length * 100 + 40);
  const center = width / 2;

  let svg = `<svg viewBox="0 0 ${width} ${height}"
    role="img" aria-label="Illustrative directed acyclic graph">`;

  expressions.forEach((item, index) => {
    const y = 20 + index * 100;
    const leftX = center - 125;
    const rightX = center + 125;

    svg += `
      <path class="graph-edge" d="M ${leftX + 35} ${y + 58}
        L ${center - 20} ${y + 15}"></path>
      <path class="graph-edge" d="M ${rightX - 35} ${y + 58}
        L ${center + 20} ${y + 15}"></path>

      <rect class="dag-node" x="${center - 30}" y="${y}"
        width="60" height="32" rx="8"></rect>
      <text class="dag-text" x="${center}" y="${y + 21}"
        text-anchor="middle">${escapeHTML(item.operator)}</text>

      <rect class="dag-node" x="${leftX}" y="${y + 48}"
        width="70" height="30" rx="7"></rect>
      <text class="dag-text" x="${leftX + 35}" y="${y + 67}"
        text-anchor="middle">${escapeHTML(item.left)}</text>

      <rect class="dag-node" x="${rightX - 70}" y="${y + 48}"
        width="70" height="30" rx="7"></rect>
      <text class="dag-text" x="${rightX - 35}" y="${y + 67}"
        text-anchor="middle">${escapeHTML(item.right)}</text>

      <text x="${center}" y="${y + 94}" text-anchor="middle"
        fill="#718096" font-size="10">
        Result: ${escapeHTML(item.variable)}
      </text>
    `;
  });

  svg += "</svg>";
  container.innerHTML = svg;
}

function analyzeCode() {
  const code = sourceCode.value.trim();

  if (!code) {
    message.textContent = "Please enter some source code before analyzing.";
    return;
  }

  message.textContent = "";

  const statements = getStatements(code);
  const blocks = createBasicBlocks(statements);
  const result = optimizeStatements(statements);

  const originalCount = statements.length;
  const optimizedCount = result.optimized.length;

  const reduction = originalCount
    ? Math.max(
        0,
        Math.round(
          ((originalCount - optimizedCount) / originalCount) * 100
        )
      )
    : 0;

  document.getElementById("statementCount").textContent = originalCount;
  document.getElementById("blockCount").textContent = blocks.length;
  document.getElementById("repeatCount").textContent =
    result.optimizationCount;
  document.getElementById("reduction").textContent = reduction + "%";

  document.getElementById("optimizedOutput").textContent =
    result.optimized.length
      ? result.optimized.join("\n")
      : "No optimizable statements found.";

  document.getElementById("originalOutput").textContent = code;

  const explanation = document.getElementById("optimizationExplanation");

  if (result.explanations.length) {
    explanation.innerHTML = result.explanations.map(item => `
      <div class="explanation-item">
        <span>✓</span>
        <p>${escapeHTML(item)}</p>
      </div>
    `).join("");
  } else {
    explanation.textContent =
      "No supported optimization patterns were detected in this input.";
  }

  renderBlocks(blocks);
  renderCFG(blocks);
  renderDAG(statements);

  document.getElementById("inputHint").textContent =
    "Analysis completed successfully.";
}

analyzeBtn.addEventListener("click", analyzeCode);

clearBtn.addEventListener("click", () => {
  sourceCode.value = "";
  updateLineNumbers();

  message.textContent = "";
  document.getElementById("inputHint").textContent =
    "Enter your C-like code to begin analysis.";

  document.getElementById("statementCount").textContent = "0";
  document.getElementById("blockCount").textContent = "0";
  document.getElementById("repeatCount").textContent = "0";
  document.getElementById("reduction").textContent = "0%";

  document.getElementById("optimizedOutput").textContent =
    "Your optimized code will appear here.";

  document.getElementById("originalOutput").textContent =
    "Original source code will appear here.";

  document.getElementById("optimizationExplanation").textContent =
    "Run the analyzer to view optimization details.";

  document.getElementById("blocksOutput").innerHTML =
    '<div class="empty-state">Basic blocks will appear here.</div>';

  document.getElementById("cfgOutput").innerHTML =
    '<div class="empty-state">Control flow graph will appear here.</div>';

  document.getElementById("dagOutput").innerHTML =
    '<div class="empty-state">DAG visualization will appear here.</div>';
});

document.querySelectorAll(".copy-btn").forEach(button => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);

    try {
      await navigator.clipboard.writeText(target.textContent);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    } catch {
      button.textContent = "Copy unavailable";
    }
  });
});

updateLineNumbers();
