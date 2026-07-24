# WP10 · Nómina Modo A+ (blocked_external: gate legal)

CONTEXTO — Doc 15 §3: pagos del core en USDC wallet-a-wallet desde multisig de la SAS, con contrato anclado por hash y registro verificable. GATE: consulta legal/tributaria ANTES del primer pago real. La UI y el schema sí se pueden construir detrás de flag.

RESULTADO ESPERADO — Módulo privado donde cada pago del core enlaza contrato → hash anclado → transacción Stellar, verificable por el pagado y el admin.

ALCANCE
- Tabla `payroll_payments`: `user_id, period, amount_usdc, tx_hash, contract_anchor_hash, network (testnet|mainnet), status, created_by`.
- `/nomina` (visible solo para admin y el propio pagado): historial con link al explorador Stellar y al hash del contrato anclado.
- Registro manual del pago por el admin (el pago se ejecuta FUERA de la app con la multisig; la app registra y verifica). Verificación: la app consulta Horizon y confirma que la tx existe, monto y destino coinciden.
- Flag `PAYROLL_ENABLED=false` por defecto. En testnet se prueba end-to-end con USDC de prueba.

NO-ALCANCE — Ejecutar pagos desde la app (custodia = M2 escrow, tras gates). Off-ramp. Cálculo de nómina (viene del contrato de cada quien). Mainnet mientras el gate legal no esté resuelto.

CRITERIOS DE ACEPTACIÓN
- [ ] Pago registrado enlaza contrato→hash→tx y la verificación contra Horizon pasa (test con testnet).
- [ ] Visibilidad: cada quien ve solo lo suyo; admin ve todo; nadie más ve montos.
- [ ] Flag apagado = módulo invisible; suite verde en ambos estados.

OWNER — Dev 2 · GATE: John agenda consulta legal/tributaria (doc 15 día 1). TAMAÑO — M · Estimado: 1 día.
