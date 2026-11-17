# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1350 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 18 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Marionette ACPL:** 0.1 cp over 18 steered moves (18 total)

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 38%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [ ] deliver_mate (w=4, tol=tight) — incomplete, partial 0%: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 1350)"]
[Result "1-0"]
[Annotator "plan: Trade or sacrifice everything except king and queen, then win the K+Q endgame"]

1. e4 Nc6 2. d4 d5 3. exd5 Nb8 4. Be2 Qxd5 5. Nf3 e6 6. c4 Qd8 7. Nc3 Nf6 8. Qc2 Nc6 9. Be3 Ng4 10. a3 Be7 11. O-O-O Nxe3 12. fxe3 O-O 13. h4 Bd7 14. d5 Nb8 15. dxe6 fxe6 16. Ng5 Rf2 17. Qxh7+ Kf8 18. Qh8# 1-0
```
