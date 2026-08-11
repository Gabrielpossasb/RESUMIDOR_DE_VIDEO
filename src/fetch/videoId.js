const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isValidId(id) {
  return typeof id === "string" && VIDEO_ID_PATTERN.test(id);
}

export function extractVideoId(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("URL do vídeo não pode ser vazia.");
  }

  const trimmed = input.trim();

  let url = null;
  try {
    url = new URL(trimmed);
  } catch {
    // não é uma URL válida — tratado abaixo como possível ID puro
  }

  if (url) {
    const host = url.hostname.replace(/^www\.|^m\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      if (isValidId(id)) return id;
    } else if (host === "youtube.com") {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        if (isValidId(id)) return id;
      }
      const pathMatch = url.pathname.match(
        /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/
      );
      if (pathMatch) return pathMatch[1];
    }
  }

  if (isValidId(trimmed)) return trimmed;

  throw new Error(`URL do YouTube não reconhecida: "${input}"`);
}
