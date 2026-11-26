# Security Specification — Cadence Study

## 1. Data Invariants
1. **Unlisted Lecture Isolation**: Unlisted YouTube lecture links (`youtubeUrl`, `youtubeVideoId`) exist solely inside `/batches/{batchId}/lectures/{lectureId}` and are NEVER stored on `/batches/{batchId}`. Only an authenticated Admin or a verified student with an `active` `/purchases/{userId}_{batchId}` document may read (`get` or `list`) lectures for that batch.
2. **Admin-Only Lecture & Batch Mutation**: Only verified Admins (`isAdmin()`) may create, update, or delete `/batches/{batchId}` or `/batches/{batchId}/lectures/{lectureId}`. Students cannot add, edit, or delete unlisted YouTube lecture links.
3. **Purchase Integrity**: Purchase document IDs must strictly follow `{userId}_{batchId}`. Students may only create a purchase for their own `request.auth.uid`, referencing an existing published batch, with `status == 'active'` and `purchasedAt == request.time`. Only Admins may revoke or modify existing purchase statuses.
4. **Student Study Data Isolation**: `/users/{userId}`, `/subjects/{subjectId}`, `/studySessions/{sessionId}`, and `/habits/{habitId}` are strictly isolated to their owning `userId == request.auth.uid` (or Admins). `list` queries on these collections enforce `resource.data.userId == request.auth.uid`.
5. **Relational & Temporal Integrity**: Every `studySession` must reference an existing `subjectId` owned by the same `request.auth.uid`. All `createdAt`, `updatedAt`, and `purchasedAt` timestamps must match `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unpurchased Lecture Read**: Student A (`studentA`) attempts `get` or `list` on `/batches/batch_phys/lectures` without `/purchases/studentA_batch_phys`.
2. **Revoked Purchase Lecture Read**: Student A attempts `get` on `/batches/batch_phys/lectures/lec_1` when `/purchases/studentA_batch_phys` has `status: 'revoked'`.
3. **Student Lecture Injection**: Non-admin Student A attempts `create` on `/batches/batch_phys/lectures/lec_99` with an unlisted YouTube URL.
4. **Student Batch Creation**: Non-admin Student A attempts `create` on `/batches/batch_fake`.
5. **Email Spoofing Admin Bypass**: Unverified user (`email_verified: false`) with admin email attempts to `create` a lecture.
6. **Shadow Field Injection on Subject**: Student A attempts `create` on `/subjects/sub_1` with an extra shadow field `isAdmin: true`.
7. **Cross-Tenant Session Spoofing**: Student A attempts `create` on `/studySessions/sess_1` with `userId: "studentB"` or referencing a `subjectId` owned by `studentB`.
8. **Timestamp Forgery**: Student A attempts `create` on `/habits/hab_1` with a backdated `createdAt` not equal to `request.time`.
9. **ID Poisoning / Resource Exhaustion**: Student A attempts `create` on `/subjects/<150-char-invalid-id!@#>` or injects a 10KB string into `notes`.
10. **PII Leak (Blanket User Read)**: Student A attempts `get` on `/users/studentB` or `list` on `/users`.
11. **Purchase ID Forgery**: Student A attempts `create` on `/purchases/studentB_batch_phys` or creates `/purchases/studentA_batch_phys` with `status: 'active'` for an unpublished/non-existent batch.
12. **Self-Assigned Admin Escalation**: Student A attempts `create` on `/admins/studentA` to grant themselves admin privileges.
