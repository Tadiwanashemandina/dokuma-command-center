/// <reference types="vite/client" />

/**
 * Vite's client types declare the asset modules (`*.png`, `*.svg`, …) that an
 * `import logo from "@/assets/logo.png"` resolves to, plus `import.meta.env`.
 *
 * Importing images through the bundler rather than referencing `/public` paths
 * is what replaces `next/image`'s build-time guarantees: a missing or renamed
 * file becomes a build error instead of a broken image in production, and each
 * file gets a content hash so it can be cached indefinitely.
 */
