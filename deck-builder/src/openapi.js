// Minimal OpenAPI description so Open WebUI can also use this service as a "tool server".
module.exports = (serverUrl) => ({
  openapi: "3.1.0",
  info: { title: "CoreBuild deck builder", version: "1.0.0", description: "Builds CoreBuild-branded Arabic (RTL) PowerPoint decks. Read GET /guide first for the slide types." },
  servers: [{ url: serverUrl }],
  paths: {
    "/guide": {
      get: {
        operationId: "get_deck_guide",
        summary: "Slide types, fields and writing rules for building a deck. Read this before calling build_deck.",
        responses: { 200: { description: "Markdown guide", content: { "text/markdown": { schema: { type: "string" } } } } },
      },
    },
    "/decks": {
      post: {
        operationId: "build_deck",
        summary: "Build a branded deck from a JSON spec. Returns pptx_url, pdf_url and warnings. If warnings mention text that is too long, shorten that text and call again.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sections"],
                properties: {
                  title: { type: "string" },
                  footer: { type: "string", description: "Project line shown at the bottom of every content slide" },
                  tagline: { type: "string", description: "e.g. COREBUILD | TECHNICAL PROPOSAL" },
                  file_name: { type: "string" },
                  sections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        slides: { type: "array", items: { type: "object", description: "A slide with a `type` field; see GET /guide" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Links and warnings" } },
      },
    },
  },
});
