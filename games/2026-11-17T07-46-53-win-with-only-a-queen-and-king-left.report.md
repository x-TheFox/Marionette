# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1350 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 23 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** compiled by kilo (kilo-auto/free)
- **Marionette ACPL:** 0.2 cp over 23 moves

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 100%: Reduce own material to exactly king + queen
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

1. e4 e5 2. Nf3 d6 3. d4 Nf6 4. dxe5 dxe5 5. Bb5+ c6 6. Bd3 Nbd7 7. O-O h6 8. Nbd2 Bd6 9. Nc4 Bc5 10. Ncxe5 O-O 11. Nxd7 Bxd7 12. e5 Nd5 13. Qe2 Re8 14. Bd2 Qc8 15. Qe4 f5 16. Qc4 Bf8 17. Rfe1 b5 18. Qh4 a6 19. a4 Be6 20. Qg3 c5 21. axb5 f4 22. Qg6 Bf7 23. Qh7# 1-0
```
