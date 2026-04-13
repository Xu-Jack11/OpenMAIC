Score the following scene outline draft against the rubric in the system prompt.

---

## Original Requirement

{{requirement}}

---

## Language

{{language}}

---

## Document Context (RAG Excerpt)

{{documentContext}}

---

## Outline Draft to Evaluate

```json
{{draft}}
```

---

Output a single JSON object `{ "score", "issues", "suggestions" }`. No additional text.
