# Integración temporal de #1331 con #1507

Revisión: 3 de noviembre de 2026, hora Argentina. No se publicó ningún cambio ni comentario.

## Fuentes y alcance exacto

- #1331: https://github.com/bilawalsidhu/gods-eye-view/pull/1331 — cabeza `f8154e34d08314eca6ad3118e9b451b4a8b842b1`, draft y con conflictos al consultar.
- #1507: https://github.com/bilawalsidhu/gods-eye-view/pull/1507 — cabeza `6ce9498d18403639e96efcacf14eb9394fe9e864`, abierto y fusionable en la consulta inicial; fusionado en la revalidación final.
- Main incorporado por #1507: `7322ce5ebd7566fabc1cd88c7847c7b2ffb8d196`.
- Revisión inicial de asturksever sobre `0c89a87d9`: https://github.com/bilawalsidhu/gods-eye-view/pull/1507#pullrequestreview-5754169525
- Respuesta del autor: https://github.com/bilawalsidhu/gods-eye-view/pull/1507#issuecomment-6611510675
- Revisión y correcciones del mantenedor, 3/11 a las 21:06 Argentina: https://github.com/bilawalsidhu/gods-eye-view/pull/1507#issuecomment-6618736925

El mantenedor afirma que la nueva revisión resuelve el P1 y todos los P2, añade commits y anuncia que fusionará cuando CI esté verde. La revalidación final confirma que #1507 se fusionó el 3/11 a las 21:14:58 Argentina (4/11 00:14:58 UTC), mediante `73c14ac7497f54c029e5253326b059417b4cf546`, con la misma cabeza examinada. Esto confirma la aceptación del dock; no implica aprobación de ChatGPT/Responses.

## Comparación funcional del código actual

| Responsabilidad | #1507 | #1331 | Integración recomendada |
|---|---|---|---|
| Conversación escrita sin micrófono | Sí, HTTP | Sí, HTTP | Una sola superficie |
| Interfaz | ChatPanel.vue, presenter del dock, estado reactivo | AgentConsole.vue, controlador y store Pinia | Dock de #1507; trasladar controles de cuenta/modelo a Settings |
| OpenAI con API key | Chat Completions, modelo fijado en servidor | Proveedor OpenAI compatible, elección de modelo | Conservar ruta de #1507 para API keys |
| Gemini | generateContent con firmas de pensamiento | Sin proveedor Gemini | Conservar implementación del autor de #1507 |
| ChatGPT | Voz OAuth existente; chat con key se bloquea bajo GEV_PREFER_CODEX_OAUTH | Autorización independiente, PKCE, cuenta vinculada, almacenamiento protegido | Mantener rutas y ciclo de autorización de #1331 |
| Responses | No | SSE validado en servidor y continuación mediante reasoning cifrado | Mantener transporte y metadatos de #1331 |
| Descubrimiento de modelos | Modelos de chat configurados por operador | Lista de modelos autorizados y controles de contexto | Añadir selector explícito al dock para ChatGPT |
| OpenRouter/Ollama | No | Sí | Posponer esos proveedores a contribución separada reduce alcance de #1331 |
| Acciones del mapa | Session.runAction → runner existente | Mismo runner inyectado desde la aplicación | Una autoridad de ejecución; ninguna segunda instancia |
| Bucle de herramientas | textChat.js: 8 rondas y 16 llamadas, protocolo por proveedor | agentLoop.js: 8 rondas, políticas de HUD/panel, validación del servidor | Adaptar eventos, conservar el motor Responses; converger después las políticas, sin traducir opacos a Chat Completions |
| STOP/fallos | Conserva historial y pares de herramientas tras las correcciones | Abort e historial en sesión de agente | Preservar semántica de cancelación y rechazar respuestas tardías |
| Adjuntos | Cuatro referencias/archivos; 10 KB **en total** | Sin interfaz equivalente | Reutilizar adjuntos del dock, con validación del límite más restrictivo de COMMAND |
| Contexto/políticas | Eventos de mapa, radio, herramientas de voz | Consultas y políticas específicas de HUD/panel; radio prepara sin reproducir | No prometer equivalencia automática de radio/contexto |
| Credenciales | Sólo servidor; origen, límites, throttles, cooldown | Además aislamiento local y binding de cuenta | Mantener admisión ChatGPT más restrictiva |

## Correcciones recientes de #1507 verificadas en el código y sus pruebas

- host.js excluye textOnly del vencimiento por inactividad; host.test.mjs contiene la regresión con tiempo simulado.
- textChat.js separa cancelTurn de stop; fallo o STOP conserva los turnos anteriores y cierra los pares de llamadas iniciadas/canceladas/omitidas.
- Se rearma el plazo por solicitud y por acción. Se conserva la prueba añadida por el mantenedor (`66fb4b6a`).
- /api/openai/chat rechaza el modo forzado OAuth en vez de facturar una API key. Los límites chat heredan los del proveedor cuando no están definidos, y Pinokio los transmite.
- Rutas y pruebas cubren métodos, tamaño, Content-Type, timeout, desconexión, sanitización, throttle, rechazo de clave y cooldown.
- Publicación del texto separada de la UI general; animación sólo cuando trabaja, aria-busy, selección de adjuntos explícita y scroll respetuoso.
- Los commits del mantenedor conservados abren realmente Voice Settings/Preview cuando chat los ocultaba, mantienen preferencias accesibles, corrigen el aviso de 10 KB total, siguen un nuevo mensaje cuando el log llega a 60 y trasladan foco al panel solicitado.

No presento las verificaciones de inferencia real declaradas por el autor como pruebas ejecutadas aquí. El mantenedor aún señala como pendientes el modelo Gemini con thinkingLevel y la aceptación real de todos los esquemas OpenAI con strict:false.

## Cambios preparados

Rama local: `integration/1331-1507-chatgpt`. Se integraron ambas historias sin rebase, squash ni cambio de autoría; se conservan las contribuciones de manjunath22466, darrendignam, radianx y los commits del mantenedor.

1. Resolución conjunta de traducciones y registros. El manual conserva los avances upstream de geometría y Overpass junto con los contratos de #1331 sobre evidencia de fuentes y confirmación del estado efectivo del HUD. Se conserva el target Street Level. El paquete upstream drone-airspace declara ahora también el suplemento árabe de COMMAND, que carga mediante el módulo compartido de traducciones.
2. `src/agent/dockTextSession.js`: puente optativo entre el contrato de sesión del dock y createAgentSession. No contiene otro bucle de herramientas. Exige provider=chatgpt, modelo y binding explícitos; conserva reasoning opaco e historial; STOP cancela el turno; stop/cambio de cuenta inicia un historial nuevo; resultados tardíos quedan invalidados. No existe fallback a una API key.
3. Las sesiones OpenAI y Gemini aceptan una fábrica de texto inyectada. El host puede usar el puente sin cambiar su proveedor de voz ni importar lógica de credenciales en la UI. El aviso de autenticación se puede suministrar desde el host; el puente no muestra el aviso incorrecto de facturación API del camino por clave.
4. COMMAND reutiliza offeredTools de upstream: osm_query sólo se ofrece y valida con Overpass configurado. El prompt y la estimación de contexto coinciden con ese conjunto, evitando aceptar herramientas que la UI no ofreció.
5. Pruebas de integración para cuenta/modelo, Responses opaco, round-trip de herramientas, historial, cancelación, aislamiento entre cuentas, desmontaje y separación de voz. Prueba de rutas con y sin Overpass y rechazo de herramientas no ofrecidas. Los tests de foco y los pins de esquema se ajustaron a la unión comprobada de ambas contribuciones; el pin de argumentos heredados se conserva.

Ejemplo de conexión para un host, después de autorización y selección explícitas:

```js
createTextSession: (options) => createDockTextSession({
  ...options,
  getSelection: () => ({ provider: 'chatgpt', model, binding }),
  getAuthNote: () => localizedChatGptPrivacyNotice,
})
```

La sesión captura la selección al iniciarse. Cambiar de cuenta/modelo requiere stop antes de start. El servidor sigue verificando binding y admisión local en cada solicitud. Tokens y reasoning cifrado nunca se exponen como texto del transcript.

## Límite deliberado del prototipo

Este es un puente probado y una rama para evaluar convivencia, no una migración final del producto. No se activa de forma predeterminada, no se eliminó AgentConsole y no se añadió un selector de cuenta/modelo al dock. Retirar la consola antes de trasladar sus controles perdería acceso a autorización, logout y aislamiento de cuenta. Esa migración requiere el acuerdo de los mantenedores sobre la superficie y su aviso de privacidad.

Tampoco se promete soporte de radio handoff ni eventos de mapa en el puente: sendMapEvent devuelve false. El motor actual obtiene contexto con herramientas. Adjuntos del dock necesitan ajuste adicional: COMMAND limita cada mensaje a 8.000 caracteres y los resultados a 6.000; no conviene anunciar compatibilidad íntegra con el presupuesto de adjuntos del dock hasta armonizar límites y errores. Las pruebas usan red/account fixtures; no hubo OAuth real, inferencia paga, Windows nativo ni navegador con cuenta real.

## Propuesta de arquitectura y secuencia con mayor posibilidad de aceptación

1. Usar main con #1507 ya fusionado como base de la interfaz y de los transportes OpenAI/Gemini, conservando su autoría.
2. Reducir la propuesta de #1331 a ChatGPT: autorización independiente, modelos, Responses y adaptador para el mismo dock. Los proveedores adicionales, la consola flotante y cambios visuales independientes se pueden separar en contribuciones posteriores, sin borrar su historial.
3. Mostrar account/model/logout y el aviso de datos en Settings del dock. La elección de ChatGPT debe ser explícita; no inferirla del OAuth de voz/Codex ni abrir silenciosamente el camino facturable.
4. Cambios de cuenta/proveedor cancelan tareas activas y separan historial; micrófono, STOP, cierre y desmontaje siguen el contrato del dock.
5. Antes de retirar la consola, validar desde el navegador autorización, cambio de cuenta, logout, selección de modelo y continuidad real de Responses. Después unificar políticas neutrales de turnos/herramientas con pruebas compartidas, evitando reescribir ambos motores de una vez.

La preferencia por esta arquitectura es una inferencia del avance y la revisión explícita del mantenedor en #1507; no una aprobación obtenida para #1331.

## Comentario de coordinación propuesto — NO enviado

Hi @manjunath22466, @samehkhamis — now that #1507 is merged, I compared the current #1507 head (`6ce9498d`) with my #1331 and prepared a local integration branch. The idle-timeout, cancelled-turn history, OAuth billing lock, per-action deadlines and the latest panel/focus fixes are retained.

I suggest keeping the merged #1507 implementation as the owner of the shared chat surface and its OpenAI/Gemini API-key transports. I can narrow #1331 to the independent ChatGPT authorization lifecycle, account-bound model discovery and Responses transport, exposed through that same dock instead of another conversation UI.

The local prototype injects a text-session factory into the existing adapters and maps the COMMAND engine to the dock's session events. It preserves encrypted Responses continuation, account bindings and cancellation without introducing another action runner or an API-key fallback. It does not yet move account/model/logout controls into Chat Settings, or claim full attachment/radio parity.

Would that split fit your intended direction? If so, I propose a small shared text-session seam first, then the ChatGPT provider and account controls on top of main with #1507. I would keep your commits and Darren's attribution intact, and separate the additional providers and floating console from the initial ChatGPT review. I can share the integration patch and test results for review.
