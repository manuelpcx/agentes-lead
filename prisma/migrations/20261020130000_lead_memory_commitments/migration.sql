-- Compromisos con fecha del lead (promesas de pago, pedidos de recontacto),
-- cada uno con su estado. Ver src/memory/commitments.ts.
ALTER TABLE "LeadMemory" ADD COLUMN "commitments" JSONB NOT NULL DEFAULT '[]';

-- Herramientas nuevas para manejarlos. Un agente con lista vacía ya las ve
-- todas; a los que tienen lista explícita (todos los creados desde el panel)
-- se les agregan, porque el panel no tiene cómo editar las herramientas.
UPDATE "Agent"
SET "enabledTools" = array_append("enabledTools", 'programarRecontacto')
WHERE cardinality("enabledTools") > 0
  AND NOT ('programarRecontacto' = ANY("enabledTools"));

UPDATE "Agent"
SET "enabledTools" = array_append("enabledTools", 'actualizarCompromiso')
WHERE cardinality("enabledTools") > 0
  AND NOT ('actualizarCompromiso' = ANY("enabledTools"));
