import { useEffect, useRef, useState } from "react";
import {
  Bot,
  BarChart3,
  CalendarCheck,
  ChevronDown,
  Clock,
  CloudRain,
  History,
  ExternalLink,
  ImagePlus,
  MapPin,
  Maximize2,
  Mic,
  MessageSquarePlus,
  Minimize2,
  Plus,
  Send,
  Square,
  Pause,
  Play,
  Shirt,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import mermaid from "mermaid";
import { adminAPI, chatbotAPI, clientAPI, hostAPI } from "../services/api";
import { transcribeAudio, speakText, stopSpeaking, pauseSpeaking, resumeSpeaking } from "../services/voice";
import { AUTH_EVENT } from "../utils/authSession";
import "./Chatbot.css";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
});

const welcomeMessage = {
  id: "welcome",
  sender: "assistant",
  text: "Hi! I’m your Gatherly assistant. Ask me about events, hosts, venues, applications, training, transportation, or Gatherly policies.",
};

const readLoggedIn = () => Boolean(localStorage.getItem("token"));
const readRole = () => localStorage.getItem("role") || "";

function splitAssistantContent(text) {
  const raw = String(text || "");

  // Only pull "block" images (charts) out of the text.
  // Host/outfit ![Name](url) stay inline for FormattedMessage.
  const imageUrls = [];
  const withoutBlockImages = raw.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (full, alt, url) => {
      const a = String(alt || "").trim().toLowerCase();
      const u = String(url || "").toLowerCase();
      const isChart =
        a === "chart"
        || u.includes("quickchart.io")
        || u.includes("/chart?");
      if (isChart) {
        if (url && !imageUrls.includes(url)) imageUrls.push(url);
        return "";
      }
      return full;
    },
  ).trim();

  const mermaidBlocks = [];
  const withoutMermaid = withoutBlockImages.replace(
    /```mermaid\s*([\s\S]*?)```/gi,
    (_full, code) => {
      mermaidBlocks.push(String(code || "").trim());
      return "\n";
    },
  );

  return {
    text: withoutMermaid.trim(),
    imageUrls,
    mermaidBlocks,
  };
}


function formatPage(page) {
  if (page == null || page === "") return "";
  return Array.isArray(page) ? page.join(", ") : String(page);
}

function RagMatchCard({ card, index }) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const heading = card?.heading || card?.section_title || `Match ${index + 1}`;
  const context = String(card?.context || card?.doc_text || "").trim();
  const visual = String(card?.visual_description || "").trim();
  const imageUrl = card?.image_url;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setFlipped(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!imageUrl) return null;

  return (
    <>
      <article className="rag-match-card">
        <button
          type="button"
          className="rag-match-image-button"
          onClick={() => {
            setOpen(true);
            setFlipped(false);
          }}
          aria-label={`Open ${heading}`}
        >
          <img src={imageUrl} alt={heading} />
        </button>
        <p className="rag-match-hint">Click to enlarge · flip for details</p>
      </article>

      {open ? (
        <div
          className="rag-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          onClick={() => {
            setOpen(false);
            setFlipped(false);
          }}
        >
          <div
            className="rag-lightbox-inner"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="rag-lightbox-close"
              onClick={() => {
                setOpen(false);
                setFlipped(false);
              }}
              aria-label="Close"
            >
              ×
            </button>

            <div className={`rag-flip ${flipped ? "is-flipped" : ""}`}>
              <div className="rag-flip-face rag-flip-front">
                <img src={imageUrl} alt={heading} />
                <button
                  type="button"
                  className="rag-flip-toggle"
                  onClick={() => setFlipped(true)}
                >
                  Flip for details
                </button>
              </div>
              <div className="rag-flip-face rag-flip-back">
                <div className="rag-flip-meta">
                  <div>
                    <span>Heading</span>
                    <strong>{heading || "—"}</strong>
                  </div>
                  <div>
                    <span>Context</span>
                    <strong>{context || "—"}</strong>
                  </div>
                  <div>
                    <span>VLM</span>
                    <strong>{visual || "—"}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="rag-flip-toggle"
                  onClick={() => setFlipped(false)}
                >
                  Back to image
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function RagAnswerPanel({ rag }) {
  const cards = Array.isArray(rag?.cards) ? rag.cards : [];
  const imageCards = cards.filter((card) => card?.image_url);
  const textSourcesFromApi = Array.isArray(rag?.text_sources) ? rag.text_sources : [];
  const imageSources = Array.isArray(rag?.image_sources) ? rag.image_sources : [];

  // Text-only "matches" live only in Sources (same info — no duplicate Match cards)
  const textSources = textSourcesFromApi.length
    ? textSourcesFromApi
    : cards
        .filter((card) => !card?.image_url)
        .map((card) => ({
          file_name: card?.file_name,
          page_number: card?.page,
          section_title: card?.section_title || card?.heading || "",
          text: card?.doc_text || card?.context || "",
        }));

  const hasSources =
    textSources.length > 0 || imageSources.length > 0 || imageCards.length > 0;

  if (!imageCards.length && !hasSources) return null;

  return (
    <div className="rag-answer-panel">
      {imageCards.length > 0 ? (
        <div className="rag-match-list">
          {imageCards.map((card, index) => (
            <RagMatchCard
              key={`${card?.image_id || card?.file_name || "card"}-${index}`}
              card={card}
              index={index}
            />
          ))}
        </div>
      ) : null}

      {hasSources ? (
        <details className="rag-sources-dropdown">
          <summary>Sources (optional)</summary>

          {textSources.length > 0 ? (
            <div className="rag-sources-group">
              <strong className="rag-sources-label">Document text</strong>
              <ol className="rag-sources-cards">
                {textSources.map((source, index) => {
                  const title =
                    source?.section_title
                    || source?.heading
                    || `Source ${index + 1}`;
                  const pageLabel = source?.page_number != null && source?.page_number !== ""
                    ? source.page_number
                    : formatPage(source?.page);
                  return (
                    <li key={`text-source-${index}`} className="rag-source-card">
                      <strong className="rag-source-title">{title}</strong>
                      <p className="rag-source-meta">
                        {source?.file_name || "document"}
                        {pageLabel ? ` · page ${pageLabel}` : ""}
                      </p>
                      {source?.text ? (
                        <p className="rag-source-snippet">{source.text}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {(imageSources.length > 0 || imageCards.length > 0) ? (
            <div className="rag-sources-group">
              <strong className="rag-sources-label">Images</strong>
              <ol className="rag-sources-cards">
                {(imageSources.length ? imageSources : imageCards).map((source, index) => {
                  const title =
                    source?.section_title
                    || source?.heading
                    || source?.file_name
                    || `Image ${index + 1}`;
                  return (
                    <li key={`image-source-${index}`} className="rag-source-card">
                      <strong className="rag-source-title">{title}</strong>
                      <p className="rag-source-meta">
                        {source?.file_name || "document"}
                        {formatPage(source?.page) ? ` · page ${formatPage(source.page)}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}


function MermaidBlock({ code, blockId }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      if (!containerRef.current || !code) return;
      try {
        const { svg } = await mermaid.render(
          `mmd${String(blockId).replace(/[^a-zA-Z0-9]/g, "")}${Date.now()}`,
          code,
        );
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (error) {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML =
            `<pre class="mermaid-error">${String(error.message || error)}</pre>`;
        }
      }
    };

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, blockId]);

  return <div className="mermaid-block" ref={containerRef} />;
}

function formatInlineMarkdown(text) {
  const raw = String(text || "").trim();
  if (!raw) return raw;

  const nodes = [];
  // Order matters: ** before *, __ before _
  const pattern =
    /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[([TI]\d+)\]|(https?:\/\/[^\s<]+))/gi;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(raw.slice(lastIndex, match.index));
    }
    if (match[2] || match[3]) {
      nodes.push(
        <strong key={`md-strong-${key++}`}>{match[2] || match[3]}</strong>,
      );
    } else if (match[4] || match[5]) {
      nodes.push(
        <em key={`md-em-${key++}`}>{match[4] || match[5]}</em>,
      );
    } else if (match[6]) {
      nodes.push(
        <code key={`md-code-${key++}`} className="chat-inline-code">
          {match[6]}
        </code>,
      );
    } else if (match[8]) {
      const alt = match[7] || "";
      nodes.push(
        <img
          key={`md-img-${key++}`}
          className="chat-inline-avatar"
          src={match[8]}
          alt={alt}
          title={alt}
        />,
      );
    } else if (match[10]) {
      const label = match[9] || match[10];
      const href = match[10].replace(/[.,;:!?)]+$/, "");
      nodes.push(
        <a
          key={`md-mdlink-${key++}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="chat-inline-link"
        >
          {label}
        </a>,
      );
    } else if (match[11]) {
      nodes.push(
        <sup key={`md-cite-${key++}`} className="rag-cite">{match[11]}</sup>,
      );
    } else if (match[12]) {
      const href = match[12].replace(/[.,;:!?)]+$/, "");
      if (/google\.com\/maps/i.test(href)) {
        nodes.push("");
      } else {
        nodes.push(
          <a
            key={`md-link-${key++}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="chat-inline-link"
          >
            {href}
          </a>,
        );
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    nodes.push(raw.slice(lastIndex));
  }

  return nodes.length ? nodes : raw;
}

const GOOGLE_MAPS_URL_RE = /https?:\/\/(?:www\.)?google\.com\/maps\/[^\s)\]>"']+/gi;

function parseCoordPair(value) {
  if (!value) return null;
  const [lat, lon] = String(value).split(",").map((part) => Number(part.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function parseGoogleMapsUrl(url) {
  try {
    const parsed = new URL(url);
    const origin = parseCoordPair(parsed.searchParams.get("origin"));
    const destination = parseCoordPair(parsed.searchParams.get("destination"));
    return { url, origin, destination };
  } catch {
    return { url, origin: null, destination: null };
  }
}

function extractGoogleMapsUrls(text) {
  const urls = [];
  const cleaned = String(text || "")
    .replace(GOOGLE_MAPS_URL_RE, (match) => {
      urls.push(match.replace(/[.,;:!?)]+$/, ""));
      return " ";
    })
    .replace(/\s+/g, " ")
    .replace(/\s*[:|-]\s*$/g, "")
    .trim();
  return { cleaned, urls: [...new Set(urls)] };
}

function buildRouteEmbedUrl({ origin, destination }) {
  if (origin && destination) {
    return (
      `https://www.google.com/maps`
      + `?saddr=${origin.lat},${origin.lon}`
      + `&daddr=${destination.lat},${destination.lon}`
      + `&output=embed`
    );
  }
  const point = destination || origin;
  if (!point) return null;
  return (
    `https://www.google.com/maps`
    + `?q=${point.lat},${point.lon}`
    + `&z=13&output=embed`
  );
}

function GoogleMapsPreview({ url }) {
  const parsed = parseGoogleMapsUrl(url);
  const embedSrc = buildRouteEmbedUrl(parsed);

  return (
    <div className="chat-map-preview">
      <div className="chat-map-preview-media">
        {embedSrc ? (
          <iframe
            title="Route map preview"
            src={embedSrc}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div className="chat-map-preview-fallback">
            <MapPin size={22} />
            <span>Google Maps route</span>
          </div>
        )}
      </div>
      <a
        className="chat-map-preview-footer"
        href={parsed.url}
        target="_blank"
        rel="noreferrer"
      >
        <strong>Live route</strong>
        <span>
          <MapPin size={13} />
          Click to open full map
        </span>
      </a>
    </div>
  );
}

function renderTextWithMaps(text, keyPrefix) {
  const { cleaned, urls } = extractGoogleMapsUrls(text);
  const nodes = [];
  if (cleaned) {
    nodes.push(
      <span key={`${keyPrefix}-text`}>{formatInlineMarkdown(cleaned)}</span>,
    );
  }
  urls.forEach((url, index) => {
    nodes.push(
      <GoogleMapsPreview key={`${keyPrefix}-map-${index}`} url={url} />,
    );
  });
  return nodes;
}

function RagInlineRefs({ rag }) {
  const textSources = Array.isArray(rag?.text_sources) ? rag.text_sources : [];
  const imageSources = Array.isArray(rag?.image_sources) ? rag.image_sources : [];
  const imageCards = Array.isArray(rag?.cards)
    ? rag.cards.filter((card) => card?.image_url)
    : [];

  const refs = [];

  textSources.forEach((source, index) => {
    const page = source?.page_number != null && source?.page_number !== ""
      ? source.page_number
      : formatPage(source?.page);
    refs.push({
      key: `t-${index}`,
      label: `T${index + 1}`,
      detail: [
        source?.file_name || "document",
        page ? `p.${page}` : "",
        source?.section_title || "",
      ].filter(Boolean).join(" · "),
    });
  });

  const images = imageSources.length ? imageSources : imageCards;
  images.forEach((source, index) => {
    refs.push({
      key: `i-${index}`,
      label: `I${index + 1}`,
      detail: [
        source?.file_name || "document",
        source?.section_title || source?.heading || "",
        formatPage(source?.page) ? `p.${formatPage(source.page)}` : "",
      ].filter(Boolean).join(" · "),
    });
  });

  if (!refs.length) return null;

  return (
    <div className="rag-inline-refs">
      <span className="rag-inline-refs-label">References</span>
      <ul>
        {refs.map((ref) => (
          <li key={ref.key}>
            <span className="rag-cite-pill">{ref.label}</span>
            <span>{ref.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseMarkdownTableRow(line) {
  const raw = String(line || "").trim();
  if (!raw.includes("|")) return null;
  const cells = raw
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length < 2) return null;
  return cells;
}

function isMarkdownTableSeparator(line) {
  const cells = parseMarkdownTableRow(line);
  if (!cells) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function FormattedMessage({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let bullets = [];
  let tableRows = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {bullets.map((item, index) => (
          <li key={`bullet-${blocks.length}-${index}`}>
            {renderTextWithMaps(item, `bullet-${blocks.length}-${index}`)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  const flushTable = () => {
    if (tableRows.length < 2) {
      // Not a real table — emit rows as paragraphs
      tableRows.forEach((row) => {
        blocks.push(
          <p key={`paragraph-${blocks.length}`}>
            {formatInlineMarkdown(row.join(" | "))}
          </p>,
        );
      });
      tableRows = [];
      return;
    }

    const [header, ...body] = tableRows;
    const dataRows = body.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    blocks.push(
      <div key={`table-wrap-${blocks.length}`} className="chat-md-table-wrap">
        <table className="chat-md-table">
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={`th-${index}`}>{formatInlineMarkdown(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIndex) => (
              <tr key={`tr-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`td-${rowIndex}-${cellIndex}`}>
                    {formatInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      // Agent often inserts blank lines between markdown table rows — keep collecting.
      if (tableRows.length > 0) return;
      flushBullets();
      return;
    }

    const tableCells = parseMarkdownTableRow(line);
    if (tableCells && (tableRows.length > 0 || line.includes("|"))) {
      // Start or continue a markdown table
      if (
        tableRows.length === 0
        && !isMarkdownTableSeparator(line)
        && line.startsWith("|")
      ) {
        flushBullets();
        tableRows.push(tableCells);
        return;
      }
      if (tableRows.length > 0) {
        tableRows.push(tableCells);
        return;
      }
    } else if (tableRows.length > 0) {
      flushTable();
    }

    if (/^[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s+/, ""));
      return;
    }

    if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, ""));
      return;
    }

    if (line.startsWith("#")) {
      flushBullets();
      const heading = line.replace(/^#+\s*/, "");
      blocks.push(
        <h4 key={`heading-${blocks.length}`}>{formatInlineMarkdown(heading)}</h4>,
      );
      return;
    }

    if (/^>\s?/.test(line)) {
      flushBullets();
      const quote = line.replace(/^>\s?/, "");
      blocks.push(
        <blockquote key={`quote-${blocks.length}`} className="chat-md-quote">
          {formatInlineMarkdown(quote)}
        </blockquote>,
      );
      return;
    }

    const isShortHeading = line.endsWith(":") && line.length < 70 && !/\*\*/.test(line);
    if (isShortHeading) {
      flushBullets();
      blocks.push(
        <h4 key={`heading-${blocks.length}`}>{formatInlineMarkdown(line.slice(0, -1))}</h4>,
      );
      return;
    }

    const isLabelledFact = /^[A-Z][^:]{1,35}:\s+.+/.test(line);
    if (isLabelledFact) {
      bullets.push(line);
      return;
    }

    flushBullets();
    const { cleaned, urls } = extractGoogleMapsUrls(line);
    if (cleaned) {
      blocks.push(
        <p key={`paragraph-${blocks.length}`}>{formatInlineMarkdown(cleaned)}</p>,
      );
    }
    urls.forEach((url, index) => {
      blocks.push(
        <GoogleMapsPreview
          key={`paragraph-map-${blocks.length}-${index}`}
          url={url}
        />,
      );
    });
  });

  flushBullets();
  flushTable();
  return <div className="formatted-message">{blocks}</div>;
}

function VenueExplorerCard({ explorer }) {
  const ranked = explorer?.ranked_venues || [];
  const best = explorer?.best_match;
  const current = explorer?.current_venue;
  const barChart = explorer?.visualizations?.score_bar_chart || {};
  const radar = explorer?.visualizations?.radar_chart || {};
  const radarDatasets = radar.datasets || [];
  const axes = radar.axes || [];
  const center = 110;
  const radius = 78;

  const polygon = (values, scale = 1) => values.map((value, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / values.length;
    const amount = ((value ?? 0) / 100) * radius * scale;
    return `${center + Math.cos(angle) * amount},${center + Math.sin(angle) * amount}`;
  }).join(" ");

  if (!best) return null;

  return (
    <div className="venue-explorer-card">
      <div className="venue-explorer-hero">
        <div>
          <span className="demo-badge">Demo location</span>
          <small>Best match</small>
          <strong>{best.name}</strong>
          <p>{best.city} · {best.district} · {best.capacity} guests</p>
        </div>
        <div className="venue-score-ring"><strong>{best.final_score}</strong><span>/100</span></div>
      </div>

      <div className="venue-quick-facts">
        <span>Accessible <strong>{best.wheelchair_accessible ? "Yes" : "No"}</strong></span>
        <span>Parking <strong>{best.parking_available ? "Yes" : "No"}</strong></span>
        <span>Route <strong>{best.route_report?.travel_minutes ?? "—"} min</strong></span>
        <span>Weather <strong>{best.weather_report?.weather_score ?? "—"}/100</strong></span>
      </div>

      {best.external_links?.google_maps && (
        <a className="venue-map-link" href={best.external_links.google_maps} target="_blank" rel="noreferrer">
          <MapPin size={15} /> Open directions in Google Maps <ExternalLink size={14} />
        </a>
      )}

      <section className="venue-chart-section">
        <div className="venue-chart-heading"><BarChart3 size={16} /><strong>Overall comparison</strong></div>
        <div className="venue-bars">
          {(barChart.labels || []).map((label, index) => (
            <div className="venue-bar-row" key={label}>
              <span title={label}>{label.replace(/^Venue\s+/, "")}</span>
              <div><i style={{ width: `${barChart.values?.[index] || 0}%` }} /></div>
              <strong>{barChart.values?.[index]}</strong>
            </div>
          ))}
        </div>
      </section>

      {!!axes.length && !!radarDatasets.length && (
        <section className="venue-chart-section radar-section">
          <div className="venue-chart-heading"><Sparkles size={16} /><strong>Top-three fit radar</strong></div>
          <p className="radar-help">Each spoke is one criterion. Farther from the center means a stronger match.</p>
          <svg className="venue-radar" viewBox="-20 -20 260 260" role="img" aria-label="Top venue suitability radar chart">
            {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={polygon(axes.map(() => 100), scale)} className="radar-grid" />)}
            {axes.map((axis, index) => {
              const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
              const x = center + Math.cos(angle) * radius;
              const y = center + Math.sin(angle) * radius;
              const labelRadius = radius + 23;
              const labelX = center + Math.cos(angle) * labelRadius;
              const labelY = center + Math.sin(angle) * labelRadius;
              const shortLabel = {
                "Accessibility": "Access",
                "Event type fit": "Event fit",
                "Setting resilience": "Setting",
                "Route convenience": "Route",
              }[axis] || axis;
              return (
                <g key={axis}>
                  <line x1={center} y1={center} x2={x} y2={y} className="radar-axis" />
                  <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className="radar-label">{shortLabel}</text>
                </g>
              );
            })}
            {radarDatasets.slice(0, 3).map((dataset, index) => (
              <polygon key={dataset.record_id} points={polygon(dataset.values)} className={`radar-data radar-data-${index}`} />
            ))}
          </svg>
          <div className="radar-legend">
            {radarDatasets.slice(0, 3).map((dataset, index) => <span key={dataset.record_id} className={`legend-${index}`}>{dataset.label.replace(/^Venue\s+/, "")}</span>)}
          </div>
        </section>
      )}

      {current && (
        <div className="current-venue-note">
          <strong>Current venue: {current.name}</strong>
          <span>{current.final_score}/100 · {current.eligible ? "Eligible" : "Needs attention"}</span>
          {current.risks?.map((risk) => <small key={risk}>{risk}</small>)}
        </div>
      )}

      <div className="venue-mini-list">
        {ranked.slice(0, 3).map((venue, index) => (
          <div key={venue.record_id}><span>#{index + 1}</span><strong>{venue.name.replace(/^Venue\s+/, "")}</strong><small>{venue.route_report?.distance_km ?? "—"} km</small></div>
        ))}
      </div>
      <p className="venue-location-notice">{explorer.location_notice}</p>
    </div>
  );
}

const BRIEFING_TOOL_STEPS = new Set([
  "sql_context",
  "run_sql",
  "assignment",
  "timeline",
  "clothing",
  "team",
]);

const ACTIVITY_AGENT_ALIASES = {
  assignment_agent: "fetch_briefing_sql",
  timeline_agent: "fetch_briefing_sql",
  clothing_agent: "fetch_briefing_sql",
  team_agent: "fetch_briefing_sql",
  weather_agent: "check_event_weather",
  route_agent: "calculate_live_route",
};

function normalizeActivityAgent(step) {
  const agent = step.agent || step.step || "agent";
  if (agent === "fetch_briefing_sql") return "fetch_briefing_sql";
  if (agent === "host_event_briefing_agent" && BRIEFING_TOOL_STEPS.has(step.step)) {
    return "fetch_briefing_sql";
  }
  return ACTIVITY_AGENT_ALIASES[agent] || agent;
}

function formatActivityLabel(agent) {
  return String(agent).replaceAll("_", " ");
}

function stepLogs(step) {
  const logs = Array.isArray(step.logs) ? step.logs : [];
  if (logs.length) return logs.filter(Boolean);
  const message = step.message || step.detail || "";
  return message ? [message] : [];
}

function groupActivityStatus(substeps) {
  if (substeps.some((step) => step.status === "failed")) return "failed";
  if (substeps.some((step) => step.status === "running")) return "running";
  if (substeps.some((step) => step.status === "skipped")) return "skipped";
  return "completed";
}

function upsertActivityStep(current, progress) {
  const idx = current.findIndex((item) => item.step === progress.step);
  const message = progress.message || progress.detail || "";
  if (idx === -1) {
    return [...current, { ...progress, logs: message ? [message] : [] }];
  }
  const prev = current[idx];
  const logs = [...(prev.logs || stepLogs(prev))];
  if (message && logs[logs.length - 1] !== message) {
    logs.push(message);
  }
  return current.map((item, i) => (
    i === idx ? { ...progress, logs } : item
  ));
}

function AgentActivity({ steps }) {
  if (!steps.length) return null;

  const groups = [];
  const indexByAgent = new Map();

  for (const step of steps) {
    const agent = normalizeActivityAgent(step);
    if (!indexByAgent.has(agent)) {
      indexByAgent.set(agent, groups.length);
      groups.push({ agent, substeps: [step] });
    } else {
      groups[indexByAgent.get(agent)].substeps.push(step);
    }
  }

  return (
    <div className="agent-activity">
      <div className="agent-activity-title"><Sparkles size={15} /><strong>Agent activity</strong><span>Live</span></div>
      {groups.map((group) => {
        const status = groupActivityStatus(group.substeps);
        const logs = group.substeps.flatMap(stepLogs);
        return (
          <div key={group.agent} className={`agent-activity-step ${status}`}>
            <i>{status === "completed" ? "✓" : status === "failed" ? "!" : status === "skipped" ? "–" : ""}</i>
            <div>
              <strong>{formatActivityLabel(group.agent)}</strong>
              {logs.map((line, idx) => (
                <span key={`${group.agent}-${idx}`} className="agent-activity-substep">{line}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Chatbot() {
  const [loggedIn, setLoggedIn] = useState(readLoggedIn);
  const [role, setRole] = useState(readRole);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [panelRect, setPanelRect] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState(null);
  const fileInputRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechPaused, setSpeechPaused] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const pendingSpeakReplyRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [activitySteps, setActivitySteps] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [cachedLocation, setCachedLocation] = useState(() => {
    try {
      const raw = sessionStorage.getItem("gatherly_browser_location");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        Number.isFinite(parsed?.latitude)
        && Number.isFinite(parsed?.longitude)
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const bottomRef = useRef(null);
  const panelRef = useRef(null);

  const isHost = role === "host" || role === "user";

  const startResize = (event, direction) => {
    if (expanded || window.innerWidth <= 720 || !panelRef.current) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = panelRef.current.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let left = rect.left;
      let top = rect.top;
      let width = rect.width;
      let height = rect.height;

      if (direction.includes("left")) {
        width = Math.max(360, rect.width - dx);
        left = rect.right - width;
      }
      if (direction.includes("right")) width = Math.max(360, rect.width + dx);
      if (direction.includes("top")) {
        height = Math.max(460, rect.height - dy);
        top = rect.bottom - height;
      }
      if (direction.includes("bottom")) height = Math.max(460, rect.height + dy);

      width = Math.min(width, window.innerWidth);
      height = Math.min(height, window.innerHeight);
      left = Math.max(0, Math.min(left, window.innerWidth - width));
      top = Math.max(0, Math.min(top, window.innerHeight - height));
      setPanelRect({ left, top, width, height });
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("gatherly-resizing");
    };

    document.body.classList.add("gatherly-resizing");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const startDrag = (event) => {
    if (expanded || window.innerWidth <= 720 || event.target.closest("button") || !panelRef.current) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = panelRef.current.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const left = Math.max(0, Math.min(rect.left + moveEvent.clientX - startX, window.innerWidth - rect.width));
      const top = Math.max(0, Math.min(rect.top + moveEvent.clientY - startY, window.innerHeight - rect.height));
      setPanelRect({ left, top, width: rect.width, height: rect.height });
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("gatherly-dragging");
    };

    document.body.classList.add("gatherly-dragging");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const addMessage = (sender, text, briefing = null, explorer = null, rag = null) => {
    const safeText = typeof text === "string"
      ? text
      : Array.isArray(text)
        ? text.map((item) => item?.msg || JSON.stringify(item)).join("; ")
        : JSON.stringify(text);
    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random()}`,
        sender,
        text: safeText,
        briefing,
        explorer,
        rag,
      },
    ]);
  };

  const errorText = (error) =>
    error.response?.data?.message ||
    error.response?.data?.detail ||
    "I couldn’t reach the Gatherly assistant. Please try again.";

  const refreshConversations = async () => {
    const { data } = await chatbotAPI.listConversations();
    setConversations(data);
    return data;
  };

  const createConversation = async () => {
    if (loading) return null;
    setLoadingHistory(true);
    try {
      const { data } = await chatbotAPI.createConversation();
      setActiveConversationId(data.conversationId);
      setMessages([welcomeMessage]);
      setHistoryOpen(false);
      await refreshConversations();
      return data.conversationId;
    } catch (error) {
      addMessage("assistant", errorText(error));
      return null;
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadConversation = async (conversationId) => {
    if (loading) return;
    setLoadingHistory(true);
    try {
      const { data } = await chatbotAPI.getConversation(conversationId);
      const parseStoredRag = (citations) => {
        if (!citations) return null;
        if (typeof citations === "object") return citations;
        try {
          return JSON.parse(citations);
        } catch {
          return null;
        }
      };
      const storedMessages = data.messages.map((message) => ({
        id: `stored-${message.messageId}`,
        sender: message.messageRole === "user" ? "user" : "assistant",
        text: message.content,
        rag: parseStoredRag(message.citations),
      }));
      setActiveConversationId(conversationId);
      setMessages(storedMessages.length ? storedMessages : [welcomeMessage]);
      setHistoryOpen(false);
    } catch (error) {
      addMessage("assistant", errorText(error));
    } finally {
      setLoadingHistory(false);
    }
  };

  const initializeChats = async () => {
    setLoadingHistory(true);
    try {
      const items = await refreshConversations();
      if (items.length) {
        await loadConversation(items[0].conversationId);
      } else {
        const { data } = await chatbotAPI.createConversation();
        setActiveConversationId(data.conversationId);
        setMessages([welcomeMessage]);
        await refreshConversations();
      }
    } catch (error) {
      addMessage("assistant", errorText(error));
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    const syncAuth = () => {
      const active = readLoggedIn();
      setLoggedIn(active);
      setRole(readRole());
      if (!active) {
        setOpen(false);
        setConversations([]);
        setActiveConversationId(null);
        setMessages([welcomeMessage]);
        setToolsOpen(false);
        setReadinessOpen(false);
        setBriefingOpen(false);
        setExplorerOpen(false);
        setEvents([]);
      }
    };
    window.addEventListener(AUTH_EVENT, syncAuth);
    window.addEventListener("storage", syncAuth);
    return () => {
      window.removeEventListener(AUTH_EVENT, syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, []);

  useEffect(() => {
    if (open && loggedIn && !activeConversationId) initializeChats();
    // Initialization is intentionally tied to opening the widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loggedIn, activeConversationId]);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    document.body.classList.toggle("gatherly-chat-fullscreen", expanded);
    if (!expanded) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("gatherly-chat-fullscreen");
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const getBrowserLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      if (cachedLocation?.latitude != null && cachedLocation?.obtainedAt) {
        const ageMs = Date.now() - cachedLocation.obtainedAt;
        if (ageMs < 10 * 60 * 1000) {
          resolve({
            latitude: cachedLocation.latitude,
            longitude: cachedLocation.longitude,
          });
          return;
        }
      }

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const next = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            obtainedAt: Date.now(),
          };
          setCachedLocation(next);
          try {
            sessionStorage.setItem(
              "gatherly_browser_location",
              JSON.stringify(next),
            );
          } catch {
            /* ignore */
          }
          resolve({
            latitude: next.latitude,
            longitude: next.longitude,
          });
        },
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 120000,
          maximumAge: 60_000,
        },
      );
    });

  const messageNeedsBrowserLocation = (text) => {
    const t = String(text || "").toLowerCase();
    return (
      /\bbuild my interactive host briefing\b/.test(t)
      || /\bcompare suitable venues\b/.test(t)
      || /\b(host briefing|event briefing|live route|leave by|directions?|navigate|from (here|my location))\b/.test(t)
      || /\b(how (long|far)|travel time|drive to|route to)\b/.test(t)
      || /\bcompare\b/.test(t) && /\bvenues?\b/.test(t)
    );
  };

  const onPickImage = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (!result) return;
      setPendingImage({
        base64: result,
        filename: file.name || "upload.jpg",
        preview: result,
      });
    };
    reader.readAsDataURL(file);
  };

  const submitMessage = async (message, options = {}) => {
    const image = options.pendingImage ?? pendingImage;
    const text = String(message || "").trim();
    if ((!text && !image) || loading || !activeConversationId) return;

    const outboundMessage =
      text || "What wedding style is this photo?";

    const eventIdRaw = options.eventId ?? selectedEventId;
    const eventId =
      eventIdRaw === undefined || eventIdRaw === null || eventIdRaw === ""
        ? null
        : Number(eventIdRaw);
    const needsLocation = Boolean(
      options.needsLocation ?? messageNeedsBrowserLocation(outboundMessage),
    );

    addMessage("user", outboundMessage);
    setLoading(true);
    setActivitySteps([]);
    if (options.pendingImage !== undefined) {
      setPendingImage(null);
    }

    try {
      const extras = {};
      if (Number.isInteger(eventId) && eventId > 0) {
        extras.eventId = eventId;
      }
      if (image?.base64) {
        extras.imageBase64 = image.base64;
        extras.imageFilename = image.filename || "upload.jpg";
      }

      if (needsLocation) {
        setActivitySteps([
          {
            step: "location",
            status: "running",
            agent: "location",
            message: "Waiting for browser location (allow if prompted)…",
          },
        ]);
        const location = await getBrowserLocation();
        setActivitySteps([]);
        if (location) {
          extras.latitude = location.latitude;
          extras.longitude = location.longitude;
        } else {
          addMessage(
            "assistant",
            "I need your browser location for a live route. Allow location access and try again.",
          );
          setLoading(false);
          return;
        }
      }

      const response = await chatbotAPI.streamChat(
        activeConversationId,
        outboundMessage,
        extras,
      );
      const result = await consumeActivityStream(response);

      const reply = result.response || result.message || "No response was returned.";
      addMessage(
        "assistant",
        reply,
        null,
        result.explorer || result.artifacts?.explorer || null,
        result?.artifacts?.rag || null,
      );
      if (options.speakReply) {
        setSpeaking(true);
        setSpeechPaused(false);
        speakText(reply)
          .catch((error) => {
            addMessage("assistant", error.message || "Voice playback failed.");
          })
          .finally(() => {
            setSpeaking(false);
            setSpeechPaused(false);
          });
      }

      await refreshConversations();
    } catch (error) {
      addMessage("assistant", error.message || errorText(error));
    } finally {
      setActivitySteps([]);
      setLoading(false);
    }
  };


  const sendMessage = async (event) => {
    event?.preventDefault();
    const message = input.trim();
    if ((!message && !pendingImage) || recording || transcribing) return;
    const speakReply = pendingSpeakReplyRef.current;
    pendingSpeakReplyRef.current = false;
    const imageToSend = pendingImage;
    setInput("");
    setPendingImage(null);
    stopSpeaking();
    setSpeaking(false);
    setSpeechPaused(false);
    await submitMessage(message, { speakReply, pendingImage: imageToSend });
  };

  const startRecording = async () => {
    stopSpeaking();
    setSpeaking(false);
    setSpeechPaused(false);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const stopRecordingAndFill = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    });

    setRecording(false);
    recorderRef.current = null;
    setTranscribing(true);
    try {
      const text = await transcribeAudio(blob);
      if (!text) {
        addMessage("assistant", "I didn’t catch that. Try speaking again.");
        return;
      }
      setInput(text);
      pendingSpeakReplyRef.current = true;
    } finally {
      setTranscribing(false);
    }
  };

  const toggleVoice = async () => {
    if (loading || loadingHistory || transcribing) return;
    try {
      if (!recording) {
        await startRecording();
        return;
      }
      await stopRecordingAndFill();
    } catch (error) {
      setRecording(false);
      setTranscribing(false);
      addMessage("assistant", error.message || "Microphone or voice service failed.");
    }
  };

  const toggleSpeechPlayback = async () => {
    if (!speaking) return;
    try {
      if (speechPaused) {
        await resumeSpeaking();
        setSpeechPaused(false);
        return;
      }
      pauseSpeaking();
      setSpeechPaused(true);
    } catch (error) {
      addMessage("assistant", error.message || "Voice playback failed.");
    }
  };

  const openReadinessTool = async () => {
    setToolsOpen(false);
    setReadinessOpen(true);
    if (events.length || eventsLoading) return;

    setEventsLoading(true);
    try {
      const { data } = await adminAPI.getEventRequests();
      const items = Array.isArray(data)
        ? data
        : data?.events || data?.requests || [];
      setEvents(items);
      if (items.length) {
        setSelectedEventId(String(items[0].eventId ?? items[0].id));
      }
    } catch (error) {
      addMessage("assistant", errorText(error));
      setReadinessOpen(false);
    } finally {
      setEventsLoading(false);
    }
  };

  const consumeActivityStream = async (response) => {
    if (!response.ok || !response.body) throw new Error("The activity stream could not be started.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        const line = block.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === "progress") {
          setActivitySteps((current) => upsertActivityStep(current, event.data));
        }

        if (event.type === "result") finalResult = event.data;
        if (event.type === "error") throw new Error(event.data?.message || "The workflow failed.");
      }
    }

    if (!finalResult) throw new Error("No final result was returned.");
    return finalResult;
  };

  const runReadinessAssessment = async () => {
    if (!selectedEventId || loading || !activeConversationId) return;
    setReadinessOpen(false);
    await submitMessage(
      `Run a complete readiness assessment for event ${selectedEventId}.`,
      {
        eventId: Number(selectedEventId),
        needsLocation: false,
      },
    );
  };

  const openBriefingTool = async () => {
    setToolsOpen(false);
    setBriefingOpen(true);
    if (events.length || eventsLoading) return;
    setEventsLoading(true);
    try {
      const { data } = await hostAPI.getMyApplications();
      const applications = Array.isArray(data) ? data : data?.applications || [];
      const accepted = applications.filter((item) => item.status === "accepted");
      setEvents(accepted);
      if (accepted.length) setSelectedEventId(String(accepted[0].eventId));
    } catch (error) {
      addMessage("assistant", errorText(error));
      setBriefingOpen(false);
    } finally {
      setEventsLoading(false);
    }
  };

  const runHostBriefing = async () => {
    if (!selectedEventId || loading || !activeConversationId) return;
    setBriefingOpen(false);
    await submitMessage(
      `Build my interactive host briefing for event ${selectedEventId}.`,
      {
        eventId: Number(selectedEventId),
        needsLocation: true,
      },
    );
  };

  const openExplorerTool = async () => {
    setToolsOpen(false);
    setExplorerOpen(true);
    if (events.length || eventsLoading) return;
    setEventsLoading(true);
    try {
      const { data } = await clientAPI.getMyEvents();
      const items = Array.isArray(data) ? data : data?.events || [];
      setEvents(items);
      if (items.length) {
        setSelectedEventId(String(items[0].eventId ?? items[0].id));
      }
    } catch (error) {
      addMessage("assistant", errorText(error));
      setExplorerOpen(false);
    } finally {
      setEventsLoading(false);
    }
  };

  const runClientEventExplorer = async () => {
    if (!selectedEventId || loading || !activeConversationId) return;
    setExplorerOpen(false);
    await submitMessage(
      `Compare suitable venues for my event ${selectedEventId}.`,
      {
        eventId: Number(selectedEventId),
        needsLocation: true,
      },
    );
  };


  const deleteConversation = async (event, conversationId) => {
    event.stopPropagation();
    if (loading) return;
    try {
      await chatbotAPI.deleteConversation(conversationId);
      const remaining = conversations.filter(
        (item) => item.conversationId !== conversationId
      );
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        if (remaining.length) {
          await loadConversation(remaining[0].conversationId);
        } else {
          await createConversation();
        }
      }
    } catch (error) {
      addMessage("assistant", errorText(error));
    }
  };

  if (!loggedIn) return null;

  return (
    <div className={`gatherly-chat ${open ? "is-open" : ""} ${historyOpen ? "history-open" : ""} ${expanded ? "expanded" : ""}`}>
      {open && (
        <section
          ref={panelRef}
          className="gatherly-chat-panel"
          style={
            !expanded && panelRect
              ? { position: "fixed", left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height }
              : undefined
          }
          aria-label="Gatherly assistant"
        >
          {["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"].map((direction) => (
            <span key={direction} className={`chat-resize-handle resize-${direction}`} onPointerDown={(event) => startResize(event, direction)} aria-hidden="true" />
          ))}
          <aside className={`gatherly-chat-history ${historyOpen ? "visible" : ""}`}>
            <div className="history-heading">
              <div><History size={18} /><strong>Chat history</strong></div>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={18} /></button>
            </div>
            <button type="button" className="new-chat-button" onClick={createConversation} disabled={loading}>
              <MessageSquarePlus size={17} /> New chat
            </button>
            <div className="conversation-list">
              {conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.conversationId}
                  className={conversation.conversationId === activeConversationId ? "active" : ""}
                  onClick={() => loadConversation(conversation.conversationId)}
                >
                  <span>{conversation.title}</span>
                  <Trash2
                    size={15}
                    role="button"
                    aria-label="Delete conversation"
                    onClick={(event) => deleteConversation(event, conversation.conversationId)}
                  />
                </button>
              ))}
            </div>
          </aside>

          <div className="gatherly-chat-main">
            <header className="gatherly-chat-header" onPointerDown={startDrag}>
              <div className="gatherly-chat-brand">
                <span className="gatherly-chat-avatar"><Sparkles size={18} /></span>
                <div><strong>Gatherly Assistant</strong><span><i /> Online</span></div>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  onClick={() => {
                    setPanelRect(null);
                    setExpanded((value) => !value);
                  }}
                  aria-label={expanded ? "Exit full screen" : "Expand to full screen"}
                  title={expanded ? "Exit full screen" : "Expand to full screen"}
                >
                  {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="Chat history"><History size={19} /></button>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close chatbot"><ChevronDown size={21} /></button>
              </div>
            </header>

            <div className="gatherly-chat-messages" aria-live="polite">
              <div className="gatherly-chat-date">Today</div>
              {messages.map((message) => (
                <div key={message.id} className={`gatherly-message ${message.sender}`}>
                  {message.sender === "assistant" && <span className="mini-avatar"><Bot size={15} /></span>}
                  <div
                    className={`message-content${
                      message.rag
                        && (
                          (Array.isArray(message.rag.cards) && message.rag.cards.length)
                          || (Array.isArray(message.rag.text_sources) && message.rag.text_sources.length)
                          || (Array.isArray(message.rag.image_sources) && message.rag.image_sources.length)
                        )
                        ? " message-content-rag"
                        : ""
                    }`}
                  >
                  {(() => {
                    const hasRagPanel = Boolean(
                      message.rag
                      && (
                        (Array.isArray(message.rag.cards) && message.rag.cards.length > 0)
                        || (Array.isArray(message.rag.text_sources) && message.rag.text_sources.length > 0)
                        || (Array.isArray(message.rag.image_sources) && message.rag.image_sources.length > 0)
                      ),
                    );
                    const {
                      text,
                      imageUrls,
                      mermaidBlocks,
                    } = splitAssistantContent(message.text);
                    return (
                      <>
                        <FormattedMessage text={text} />
                        {hasRagPanel ? <RagInlineRefs rag={message.rag} /> : null}
                        {mermaidBlocks.map((code, index) => (
                          <MermaidBlock
                            key={`${message.id}-mermaid-${index}`}
                            blockId={`${message.id}-${index}`}
                            code={code}
                          />
                        ))}
                        {hasRagPanel ? (
                          <RagAnswerPanel rag={message.rag} />
                        ) : (
                          imageUrls.map((url, index) => (
                            <img
                              key={`${message.id}-img-${index}`}
                              src={url}
                              alt={`source-${index + 1}`}
                              style={{
                                maxWidth: "100%",
                                borderRadius: 12,
                                marginTop: 8,
                                display: "block",
                              }}
                            />
                          ))
                        )}
                      </>
                    );
                  })()}

                    

                  </div>
                </div>
              ))}
              {!!activitySteps.length && <AgentActivity steps={activitySteps} />}
              {(loading || loadingHistory) && !activitySteps.length && (
                <div className="gatherly-message assistant">
                  <span className="mini-avatar"><Bot size={15} /></span>
                  <div className="typing"><span /><span /><span /></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {role === "admin" && toolsOpen && (
              <div className="gatherly-tools-menu">
                <span>Admin tools</span>
                <button type="button" onClick={openReadinessTool}>
                  <CalendarCheck size={18} />
                  <div>
                    <strong>Check Event Readiness</strong>
                    <small>Weather, staffing and logistics</small>
                  </div>
                </button>
              </div>
            )}

            {isHost && toolsOpen && (
              <div className="gatherly-tools-menu">
                <span>Host tools</span>
                <button type="button" onClick={openBriefingTool}>
                  <Sparkles size={18} />
                  <div><strong>Build Event Briefing</strong><small>Timeline, route, weather, outfit and team</small></div>
                </button>
              </div>
            )}

            {role === "client" && toolsOpen && (
              <div className="gatherly-tools-menu">
                <span>Client tools</span>
                <button type="button" onClick={openExplorerTool}>
                  <BarChart3 size={18} />
                  <div><strong>Explore Event Venues</strong><small>SQL venue match, weather, routes and interactive charts</small></div>
                </button>
              </div>
            )}

            {role === "client" && explorerOpen && (
              <div className="gatherly-readiness-picker">
                <div className="readiness-picker-heading"><div><BarChart3 size={18} /><strong>Client Event Explorer</strong></div><button type="button" onClick={() => setExplorerOpen(false)}><X size={17} /></button></div>
                <p>Select one of your events. Your current location is used temporarily for routing and is never stored. Venue destinations are demo coordinates.</p>
                <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} disabled={eventsLoading}>
                  {eventsLoading && <option>Loading events…</option>}
                  {!eventsLoading && !events.length && <option value="">No events found</option>}
                  {events.map((item) => {
                    const id = item.eventId ?? item.id;
                    return <option key={id} value={id}>{item.type || item.title || `Event ${id}`} — Event #{id}</option>;
                  })}
                </select>
                <button type="button" className="run-readiness-button" onClick={runClientEventExplorer} disabled={!selectedEventId || eventsLoading || loading}>Use location & compare venues</button>
              </div>
            )}

            {isHost && briefingOpen && (
              <div className="gatherly-readiness-picker">
                <div className="readiness-picker-heading"><div><Sparkles size={18} /><strong>Host Event Briefing</strong></div><button type="button" onClick={() => setBriefingOpen(false)}><X size={17} /></button></div>
                <p>Select one of your accepted event assignments. Your current location is used temporarily for routing and is not stored.</p>
                <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} disabled={eventsLoading}>
                  {eventsLoading && <option>Loading events…</option>}
                  {!eventsLoading && !events.length && <option value="">No accepted assignments found</option>}
                  {events.map((item) => <option key={item.eventAppId || item.id} value={item.eventId}>{item.title || `Event ${item.eventId}`} — Event #{item.eventId}</option>)}
                </select>
                <button type="button" className="run-readiness-button" onClick={runHostBriefing} disabled={!selectedEventId || eventsLoading || loading}>Use location & build briefing</button>
              </div>
            )}

            {role === "admin" && readinessOpen && (
              <div className="gatherly-readiness-picker">
                <div className="readiness-picker-heading">
                  <div>
                    <CalendarCheck size={18} />
                    <strong>Check Event Readiness</strong>
                  </div>
                  <button type="button" onClick={() => setReadinessOpen(false)} aria-label="Close readiness tool">
                    <X size={17} />
                  </button>
                </div>
                <p>Select an event for the readiness assessment.</p>
                <select
                  value={selectedEventId}
                  onChange={(event) => setSelectedEventId(event.target.value)}
                  disabled={eventsLoading}
                >
                  {eventsLoading && <option>Loading events…</option>}
                  {!eventsLoading && !events.length && <option value="">No events found</option>}
                  {events.map((event) => {
                    const id = event.eventId ?? event.id;
                    const label = event.title || event.type || `Event ${id}`;
                    return <option key={id} value={id}>{label} — Event #{id}</option>;
                  })}
                </select>
                <button
                  type="button"
                  className="run-readiness-button"
                  onClick={runReadinessAssessment}
                  disabled={!selectedEventId || eventsLoading || loading}
                >
                  Run assessment
                </button>
              </div>
            )}

            <form className="gatherly-chat-input" onSubmit={sendMessage}>
              {(role === "admin" || isHost || role === "client") && (
                <button
                  type="button"
                  className="gatherly-tools-toggle"
                  onClick={() => {
                    setToolsOpen((value) => !value);
                    setReadinessOpen(false);
                    setBriefingOpen(false);
                    setExplorerOpen(false);
                  }}
                  disabled={loading || loadingHistory}
                  aria-label="Open Gatherly tools"
                >
                  <Plus size={19} />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={onPickImage}
              />
              <button
                type="button"
                className="gatherly-mic-toggle"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || loadingHistory || recording || transcribing}
                aria-label="Attach inspiration photo"
                title="Attach inspiration photo"
              >
                <ImagePlus size={18} />
              </button>
              {pendingImage?.preview ? (
                <button
                  type="button"
                  className="gatherly-mic-toggle"
                  onClick={() => setPendingImage(null)}
                  aria-label="Remove attached photo"
                  title="Remove photo"
                  style={{ padding: 0, overflow: "hidden" }}
                >
                  <img
                    src={pendingImage.preview}
                    alt="Attached"
                    style={{ width: 32, height: 32, objectFit: "cover", display: "block" }}
                  />
                </button>
              ) : null}
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  recording
                    ? "Listening…"
                    : transcribing
                      ? "Transcribing…"
                      : pendingImage
                        ? "Add a question or send the photo…"
                        : "Ask Gatherly anything…"
                }
                disabled={loading || loadingHistory || recording || transcribing}
                aria-label="Chat message"
              />

              <button
                type="button"
                className={`gatherly-mic-toggle${recording ? " recording" : ""}`}
                onClick={toggleVoice}
                disabled={loading || loadingHistory || transcribing}
                aria-label={recording ? "Stop recording" : "Start voice message"}
              >
                {recording ? <Square size={16} /> : <Mic size={18} />}
              </button>
              {speaking && (
                <button
                  type="button"
                  className={`gatherly-speak-toggle${speechPaused ? " paused" : ""}`}
                  onClick={toggleSpeechPlayback}
                  aria-label={speechPaused ? "Resume speaking" : "Pause speaking"}
                >
                  {speechPaused ? <Play size={18} /> : <Pause size={18} />}
                </button>
              )}
              <button
                type="submit"
                disabled={
                  (!input.trim() && !pendingImage)
                  || loading
                  || loadingHistory
                  || recording
                  || transcribing
                }
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            </form>
            <small className="gatherly-chat-note">Answers are grounded in Gatherly database records.</small>
          </div>
        </section>
      )}
      <button type="button" className="gatherly-chat-launcher" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close Gatherly assistant" : "Open Gatherly assistant"}>
        {open ? <X size={24} /> : <><Bot size={25} /><span>Ask Gatherly</span></>}
      </button>
    </div>
  );
}
