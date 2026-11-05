/** Endereço público do site e imagem de compartilhamento (WhatsApp, redes, buscadores). */
export const SITE_URL = "https://odontoconnect.tech";

/** 1200×630, gerada de scripts/design/og-image.html. Antes vinha de um bucket do Lovable. */
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Frase curta da landing revisada pela Helena (sem promessa, preço ou dado de clínica). */
export const OG_TITULO = "Odonto Connect — Gestão odontológica de A a Z";
export const OG_DESCRICAO = "CRM, agenda, WhatsApp da recepção, prontuário e financeiro em uma única plataforma.";

/** Metas de imagem para o head(): Open Graph e Twitter, com URL absoluta. */
export const OG_IMAGE_META = [
  { property: "og:image", content: OG_IMAGE },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Odonto Connect: gestão odontológica de A a Z" },
  { name: "twitter:image", content: OG_IMAGE },
];
