# Chano Web Governance Checklist

Use this checklist for every material Web change.

## Before Implementation

- identify whether the change is Class A, B, or C
- identify governing Core Documents
- review 22 CHANO WEB IMPLEMENTATION STANDARD.md
- create a durable implementation record
- define exact acceptance criteria and validation evidence

## During Implementation

- keep Web projection-only
- preserve session-gated ingress and canonical validation handoff
- preserve validation-before-phase-advance ordering for snapshot_start handling
- keep ProjectionEngine as the single long-lived projection authority
- keep command_result non-authoritative for projection truth
- keep selectors and UI as consumers of projection-derived state and minimal UI-local state
- preserve the approved legacy outbound mutation-command field contract unless a coordinated cross-repo change explicitly replaces it

## Validation Minimums

Use the narrowest evidence that still proves the authoritative runtime path.

Typical evidence slices:

- transport or runtime boundary tests
- projection validation and runtime tests
- navigation or UI boundary tests
- full Angular harness when changes affect shared runtime boundaries

## Documentation And Closeout

- update 22 CHANO WEB IMPLEMENTATION STANDARD.md if lasting practice changed
- update governance documents if the workflow or evidence rule changed
- use ACP if the change alters architecture, protocol, validation, execution, or boundary law
- do not close the change until validation evidence and the implementation record are complete
