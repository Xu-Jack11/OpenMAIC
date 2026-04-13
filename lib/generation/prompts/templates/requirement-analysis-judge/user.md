Score the following requirement analysis draft against the rubric in the system prompt.

---

## Raw User Requirement

{{requirement}}

---

## Language

{{language}}

---

## Available Course Documents

{{availableDocuments}}

---

## Draft Analysis to Evaluate

```json
{{draft}}
```

---

Output a single JSON object `{ "score", "issues", "suggestions" }`. No additional text.
