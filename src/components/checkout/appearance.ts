import type { Appearance } from "@stripe/stripe-js";

/**
 * Stripe Elements Appearance API.
 *
 * The card field is a cross-origin iframe — we cannot style it with our CSS, and
 * we cannot read from it. What we *can* do is hand Stripe a theme, which is how
 * the Element ends up looking like the rest of Ledger instead of like Stripe.
 *
 * These values mirror the tokens in globals.css. They're duplicated rather than
 * imported because Stripe needs literal colour values, not CSS custom properties
 * (the iframe has no access to our :root).
 */
export const ledgerAppearance: Appearance = {
  theme: "flat",
  variables: {
    colorPrimary: "#12130f",
    colorBackground: "#f0eee6",
    colorText: "#12130f",
    colorTextSecondary: "#4a4b44",
    colorTextPlaceholder: "#85867c",
    colorDanger: "#b23a2e",
    colorSuccess: "#1a7f4b",

    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSizeBase: "14px",
    borderRadius: "2px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": {
      backgroundColor: "#f0eee6",
      border: "1px solid #a8a596",
      boxShadow: "none",
      padding: "10px 12px",
    },
    ".Input:focus": {
      border: "1px solid #12130f",
      boxShadow: "none",
      outline: "none",
    },
    ".Input--invalid": {
      border: "1px solid #b23a2e",
      boxShadow: "none",
    },
    ".Label": {
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.18em",
      color: "#85867c",
      marginBottom: "6px",
    },
    ".Error": {
      fontSize: "12px",
      color: "#b23a2e",
    },
    ".Tab": {
      border: "1px solid #c9c6b8",
      backgroundColor: "#f0eee6",
      boxShadow: "none",
    },
    ".Tab--selected": {
      border: "1px solid #12130f",
      backgroundColor: "#dedbcf",
      boxShadow: "none",
    },
  },
};
