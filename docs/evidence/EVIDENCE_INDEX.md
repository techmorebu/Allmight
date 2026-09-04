# EVIDENCE INDEX

Git holds this index. **Google Drive holds the bytes.** Every row names a sha256
so an artifact retrieved from Drive can be proven to be the one a ruling accepted.

**Verify with:** `bash docs/evidence/verify_index.sh <artifact-dir>`
An index nobody checks is a claim about evidence, not evidence.

Storage root: `Google Drive / AllMight Project / Evidence Archive / Wave 11 /`

| slice | classification | artifact | sha256 |
|---|---|---|---|
| M0 | ACCEPTED CASE A | `W11_M0_REGISTRY_VALIDATOR.zip` | `bbf7170a5a23f3141bf89092f58c4240e40944df5deb4ff1d11f4dfd78dbc548` |
| M1A | superseded | `W11_M1A_OBSERVE_SUPERVISOR.zip` | `adf825aa5e3b07004cacaa342ee23eda83ca8a9365fb0def6c58afe0e34d8756` |
| M1A-R1 | superseded | `W11_M1A_R1_REGISTRY_CHAIN.zip` | `b19638074378f4aab3a1af78a445fc65ab60d2836ec2d68553b3bfb031b0760d` |
| M1A-R2 | superseded | `W11_M1A_R2_ACTIVATION.zip` | `37c8c8d83e2484e6f605f53d8f97167fb89a413b58f81012140c894308b941c6` |
| M1A-R3 | superseded | `W11_M1A_R3_COVERAGE.zip` | `4f06d02b044c7b92429e5eaee2429acbf033cfd3f59fd6496444cf5a04ba233a` |
| M1A-R4 | superseded | `W11_M1A_R4_CANONICAL_HEALTH.zip` | `28eb2e6fdeb5e1fbd10a5dca06411e19430ad8390c1d587291d19f831f8a77a0` |
| M1A-R4-R1 | ACCEPTED CASE A | `W11_M1A_R4R1_AGGREGATE.zip` | `c7fd2b5c0dc9afb2f231ddd9821bebd251c8001a6239a6a4fa8e106b62c0544b` |
| M1B-A | superseded | `W11_M1B_A_RUNTIME_ADAPTER.zip` | `16218e3b65b298a10ada5bf2166c93df96d015b45dcd648ca77c3592d7f3da86` |
| M1B-A-R1 | superseded | `W11_M1B_A_R1_SESSION_AUTHORITY.zip` | `977a27526b339e620e53646510c53892074c2698d6d64b1a3d5b7397e03980f9` |
| M1B-A-R1-R1 | ACCEPTED CASE A | `W11_M1B_A_R1R1_FUTURE_GUARD.zip` | `b9d4e7e13f1dedc0b12c9d02c855b56ade8d68093333190e194f367ba3effa42` |
| M1B-B | IMMUTABLE DEFECT EVIDENCE | `W11_M1B_B_FIRST_OBSERVATION.zip` | `736f33b66a1fca99f4ca49a31a7e47bc8ef33e65555ebe34dbf367add9771f5c` |
| M1B-B-R1 | superseded | `W11_M1B_B_R1_SOURCE_RESOLUTION.zip` | `0173c702cd29db0e747cbc74a4b339cc6f065eb3f898ac205d5ceadd63a0a86d` |
| M1B-B-R1-R1 | ACCEPTED CASE A | `W11_M1B_B_R1R1_DIAGNOSTICS.zip` | `28a0a81c9d06082bf6137e5a34522845dbd64246a7c53709b0227f39e40d5e55` |
| M1B-B-R2 | ACCEPTED CASE A | `W11_M1B_B_R2_SECOND_OBSERVATION.zip` | `e62f3b115e486ba127c1ea68d02acba37f8bf322b7f3d2de6aef757760a9bf30` |
| M2-A | superseded | `W11_M2A_HEAT_HEARTBEAT.zip` | `4eaa483d75df6288b753e563e0ebf4c17bad192ac5db20fca8873843bf3e2f4c` |
| M2-A-R1 | ACCEPTED CASE A | `W11_M2A_R1_WRAPPER_EXCLUSION.zip` | `f7d88a3930919257ea395317a5a7a9fd534adb4fce497476fd5286299a0aac4c` |
| M2-B-R1 | superseded | `W11_M2B_R1_LOADED_BYTES.zip` | `7794bd7a77fe6ba52fcb1aaf069738a8febd6188d048b362cfe1b7a032903d59` |
| M2-C | ACCEPTED CASE A — DEPLOYMENT | `W11_M2C_HEAT_DEPLOYMENT.zip` | `bd3be268fcaad997535140b1c1603e98bae5bf0ea670a99f812af13d67b9bfc0` |
| M2-D-R1 | ACCEPTED CASE A | `W11_M2D_R1_EPOCH_RETROFIT.zip` | `7c8798c96ce150d4a4aacb7a73e68022e146c8612e211b8d903694767bef8d24` |
| M2-D-R2 | ACCEPTED CASE A | `W11_M2D_R2_ACTIVATION_OBSERVATION.zip` | `de4e1aa7cf00ce73d68bad11587d935a74eddc20301c137361e96071ef1ff468` |
| M2-D-R4 | ACCEPTED CASE A — CURRENT | `W11_M2D_R4_EMPTY_SET.zip` | `ae5987d4e5e9adebc8b236c70534bbe80aa82d86ab23d65b94ee82ceb7756e63` |
| router diag | AUTHORIZED, UNRUN | `W11_ROUTER_RECURRENCE_DIAGNOSTIC.zip` | `c2b96c44b50178b431d3f5312c089536bda71b6b2d546e690ec16f17e6059df4` |

## SUPERSEDED IS NOT DELETABLE

A superseded bundle is still the evidence that a defect existed.
**`W11_M1B_B_FIRST_OBSERVATION.zip` must never be regenerated** — it contains
the malformed `/home/allmight/Allmight/redis:/fetcher:*` that proved the
provider-source defect. Rewriting it would erase the finding.

## RAW OBSERVATION LOGS (Drive)
```
m2c_deployment.log · m2dr2_observation.log · m2dr3_attribution.log
m1bb_observation.log · incident021_r6b.log
```
