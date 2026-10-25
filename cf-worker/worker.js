// Cloudflare Worker: 선택 로그를 GitHub 저장소(logs/이름.txt)에 안전하게 커밋한다.
// GITHUB_TOKEN 은 이 코드에 넣지 않고, Cloudflare 대시보드의 "Secret" 환경변수로 등록한다.
// (env.GITHUB_TOKEN 으로 런타임에만 읽히며, 소스코드 어디에도 값이 노출되지 않는다.)

const GITHUB_OWNER = "onskyline21";
const GITHUB_REPO = "winter_windbreaker";
const GITHUB_BRANCH = "main";

// 운영 시엔 "*" 대신 실제 GitHub Pages 주소로 좁히는 것을 권장
// 예: "https://onskyline21.github.io"
const ALLOWED_ORIGIN = "*";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return jsonResponse({ error: "서버에 GITHUB_TOKEN 이 설정되지 않았습니다." }, 500, corsHeaders);
    }

    try {
      const body = await request.json();
      const { name, size, pw, design, style, variantLabel } = body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return jsonResponse({ error: "이름을 입력해 주세요." }, 400, corsHeaders);
      }
      if (!size || typeof size !== "string" || !size.trim()) {
        return jsonResponse({ error: "사이즈를 입력해 주세요." }, 400, corsHeaders);
      }
      if (!/^[0-9]{4}$/.test(pw || "")) {
        return jsonResponse({ error: "비밀번호는 숫자 4자리로 입력해 주세요." }, 400, corsHeaders);
      }

      const cfg = { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN };
      const fname = sanitizeFileName(name);
      const path = `logs/${fname}.txt`;

      const existing = await getExistingFile(path, cfg);

      if (existing) {
        const match = existing.content.match(/비밀번호:\s*([0-9]{4})/);
        const savedPw = match ? match[1] : null;
        if (savedPw && savedPw !== pw) {
          return jsonResponse(
            { error: "비밀번호가 일치하지 않습니다. 이전에 등록한 비밀번호를 입력해 주세요." },
            403,
            corsHeaders
          );
        }
      }

      const now = new Date();
      const ts = now.toISOString().replace("T", " ").slice(0, 19);
      const entry =
`[저장 시각] ${ts}
이름: ${name}
사이즈: ${size}
디자인: ${design || ""}
스타일: ${style || ""}
스폰서 마킹/엠블럼: ${variantLabel || ""}
비밀번호: ${pw}
----------------------------------------
`;
      const newContent = existing ? existing.content + "\n" + entry : entry;

      await putFile(path, newContent, existing ? existing.sha : null, cfg);

      return jsonResponse({ ok: true, message: "저장 완료! 선택 정보가 기록되었습니다." }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message || "서버 오류가 발생했습니다." }, 500, corsHeaders);
    }
  },
};

function sanitizeFileName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
}

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function ghFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "winter-windbreaker-worker",
      ...(options.headers || {}),
    },
  });
}

async function getExistingFile(path, cfg) {
  const url = `https://api.github.com/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/contents/${encodeURIComponent(
    path
  )}?ref=${cfg.GITHUB_BRANCH}`;
  const res = await ghFetch(url, cfg.GITHUB_TOKEN);
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`기존 로그 조회 실패 (${res.status}): ${t}`);
  }
  const data = await res.json();
  const content = base64DecodeUtf8(data.content.replace(/\n/g, ""));
  return { sha: data.sha, content };
}

async function putFile(path, content, sha, cfg) {
  const url = `https://api.github.com/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/contents/${encodeURIComponent(
    path
  )}`;
  const body = {
    message: sha ? `update log: ${path}` : `add log: ${path}`,
    content: base64EncodeUtf8(content),
    branch: cfg.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(url, cfg.GITHUB_TOKEN, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`저장 실패 (${res.status}): ${t}`);
  }
  return res.json();
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64DecodeUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
