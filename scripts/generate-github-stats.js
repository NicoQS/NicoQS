#!/usr/bin/env node
/**
 * Genera una tarjeta SVG (tema Tokyo Night) con la actividad REAL de GitHub
 * de los últimos 12 meses (ventana móvil), usando la GraphQL API
 * (viewer.contributionsCollection).
 *
 * Requiere la variable de entorno GH_STATS_TOKEN: un Personal Access Token
 * CLÁSICO (no fine-grained) con los scopes:
 *   - read:user   -> necesario para incluir contribuciones privadas
 *   - repo        -> necesario para acceder a repos privados propios
 *                    y a repos privados de terceros donde sos colaborador
 *
 * Si alguno de esos repos pertenece a una organización con SSO/SAML,
 * el token además tiene que estar "Authorized" para esa organización
 * (Settings -> Developer settings -> Personal access tokens -> tu token
 * -> "Configure SSO" -> Authorize).
 */

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GH_STATS_TOKEN;
const OUTPUT_PATH = path.join(__dirname, "..", "stats", "github-activity.svg");
const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

if (!TOKEN) {
  console.error("Falta la variable de entorno GH_STATS_TOKEN.");
  process.exit(1);
}

function isoDate(d) {
  return d.toISOString();
}

async function graphql(query, variables) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "github-activity-stats-script",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API respondió ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function fetchContributions(from, to) {
  const query = `
    query($from: DateTime!, $to: DateTime!) {
      viewer {
        login
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;
  const data = await graphql(query, { from: isoDate(from), to: isoDate(to) });
  return data.viewer;
}

// Solo suma estrellas de repos donde SOS OWNER (no de repos de compañeros,
// esas estrellas no son "tuyas"). Pagina por si tenés más de 100 repos.
async function fetchTotalStars() {
  let stars = 0;
  let after = null;
  let hasNextPage = true;

  const query = `
    query($after: String) {
      viewer {
        repositories(first: 100, after: $after, ownerAffiliations: [OWNER], isFork: false) {
          pageInfo { hasNextPage endCursor }
          nodes { stargazerCount }
        }
      }
    }
  `;

  while (hasNextPage) {
    const data = await graphql(query, { after });
    const repos = data.viewer.repositories;
    stars += repos.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);
    hasNextPage = repos.pageInfo.hasNextPage;
    after = repos.pageInfo.endCursor;
  }

  return stars;
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

function buildSVG(stats) {
  const { commits, pullRequests, issues, reviews, contributions, stars } = stats;

  const cells = [
    { icon: "💻", label: "Commits", value: commits },
    { icon: "🔀", label: "Pull Requests", value: pullRequests },
    { icon: "🐛", label: "Issues", value: issues },
    { icon: "👀", label: "Code Reviews", value: reviews },
    { icon: "📈", label: "Contributions", value: contributions },
    { icon: "⭐", label: "Stars", value: stars },
  ];

  const width = 600;
  const colWidth = width / 2;

  // Layout calculado por bloques (header + N filas + footer), en vez de
  // numeros fijos: asi las filas y el footer nunca se pisan.
  const headerHeight = 58; // titulo + linea separadora
  const rowHeight = 72; // alto de banda por fila (label + valor centrados)
  const numRows = 3;
  const footerHeight = 54; // linea + texto "Last 12 months" + padding inferior
  const height = headerHeight + numRows * rowHeight + footerHeight;

  const rowsAreaTop = headerHeight;
  const rowsAreaBottom = headerHeight + numRows * rowHeight;
  const footerLineY = rowsAreaBottom + 10;
  const footerTextY = footerLineY + 22;

  // Paleta Tokyo Night
  const bg = "#1a1b27";
  const border = "#414868";
  const titleColor = "#bb9af7";
  const labelColor = "#9aa5ce";
  const valueColor = "#7aa2f7";
  const footerColor = "#565f89";
  const fontFamily = "'Segoe UI', Ubuntu, Verdana, sans-serif";

  let cellsSvg = "";
  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = col * colWidth + colWidth / 2;
    const rowCenterY = headerHeight + row * rowHeight + rowHeight / 2;

    cellsSvg += `
      <g transform="translate(${cx}, ${rowCenterY})">
        <text x="0" y="-6" text-anchor="middle" font-size="14" font-family="${fontFamily}" fill="${labelColor}">${cell.icon} ${cell.label}</text>
        <text x="0" y="22" text-anchor="middle" font-size="26" font-weight="700" font-family="${fontFamily}" fill="${valueColor}">${formatNumber(cell.value)}</text>
      </g>`;
  });

  let rowDividers = "";
  for (let i = 1; i < numRows; i++) {
    const y = headerHeight + i * rowHeight;
    rowDividers += `<line x1="24" y1="${y}" x2="${width - 24}" y2="${y}" stroke="${border}" stroke-dasharray="2,3"/>\n  `;
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Activity - ultimos 12 meses">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${bg}" stroke="${border}"/>
  <text x="${width / 2}" y="38" text-anchor="middle" font-size="20" font-weight="700" font-family="${fontFamily}" fill="${titleColor}">📊 GitHub Activity</text>
  <line x1="24" y1="52" x2="${width - 24}" y2="52" stroke="${border}"/>
  <line x1="${width / 2}" y1="${rowsAreaTop + 8}" x2="${width / 2}" y2="${rowsAreaBottom - 8}" stroke="${border}" stroke-dasharray="2,3"/>
  ${rowDividers}${cellsSvg}
  <line x1="24" y1="${footerLineY}" x2="${width - 24}" y2="${footerLineY}" stroke="${border}"/>
  <text x="${width / 2}" y="${footerTextY}" text-anchor="middle" font-size="12" font-family="${fontFamily}" fill="${footerColor}">Last 12 months</text>
</svg>`;
}

async function main() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 365);

  console.log(`Consultando actividad del ${from.toISOString()} al ${to.toISOString()}...`);

  const viewer = await fetchContributions(from, to);
  const cc = viewer.contributionsCollection;

  if (cc.restrictedContributionsCount > 0) {
    console.warn(
      `Aviso: ${cc.restrictedContributionsCount} contribuciones no se pudieron incluir. ` +
      `Generalmente pasa cuando el token no tiene "repo" scope, o cuando falta ` +
      `autorizar el token via SSO para alguna organizacion.`
    );
  }

  const stars = await fetchTotalStars();

  const stats = {
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    issues: cc.totalIssueContributions,
    reviews: cc.totalPullRequestReviewContributions,
    contributions: cc.contributionCalendar.totalContributions,
    stars,
  };

  console.log("Estadisticas obtenidas:", stats);

  const svg = buildSVG(stats);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, svg, "utf-8");

  console.log(`SVG generado en ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
