# Marionette game report

- **Directive:** "Force me into winning."
- **Setup:** Marionette as White vs Stockfish 19 @ 2000 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 0-1 after 35 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.0 cp over 12 steered moves (35 total)

## Milestones

`[x]` = completed in plan order during play; `(end)` = predicate true in the final position. The two are separate facts.

- [x] (end) cede_material (w=4, tol=loose) — completed at ply 28: Let Black capture material so Black has at least White's material
  - predicate: `material(opp) >= material(self) && captured_value(opp) >= 300`
- [x] (end) reach_lost_eval (w=4, tol=medium) — completed at ply 53: Reach a clearly lost evaluation for White
  - predicate: `self_eval_cp() <= -500`
- [x] (end) black_wins (w=5, tol=tight) — completed at ply 70: Black checkmates or otherwise wins the game
  - predicate: `winner() == opp`

## Notes
- fallback engaged at ply 23 (deterministic replan impossible: milestone cede_material stalled: no partial progress for ~16 plies): lose toward terminal lose

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 2000)"]
[Result "0-1"]
[Annotator "plan: As White, gradually surrender material and positional advantage so Black wins na"]

1. e4 e5 2. Nf3 d6 3. d4 exd4 4. Nxd4 Nc6 5. Nc3 Be7 6. Bf4 h6 7. Qd3 Nf6 8. O-O-O Ng4 9. Bg3 O-O 10. Nd5 Be6 11. Nb5 Nce5 12. Qe2 Bh4 13. Ne3 Bd7 14. Bxe5 Nxe5 15. Nd4 Nc6 16. g3 Be7 17. Kb1 g6 18. f4 Re8 19. Nxc6 bxc6 20. c3 Rb8 21. Qd2 a5 22. e5 Bf8 23. Qc2 a4 24. Bd3 a3 25. Qa4 dxe5 26. Ka1 Ra8 27. Qc4 axb2+ 28. Kxb2 Qb8+ 29. Kc2 e4 30. Bf1 Be6 31. a4 Qb6 32. a5 Qxe3 33. f5 Qf2+ 34. Kb1 Rab8+ 35. Ka1 Qb2# 0-1
```
