-- Two new app sentences (18 Nov): the sign-in subtitle and the Language screen note, in the 7 non-English languages.
-- Same rows as ui-labels-32.json in the full glossary file; this one adds only these 14. Safe to run again.
-- After running: recycle the API app pool (translations are cached in memory).
SET NAMES utf8mb4;
SET time_zone = '+00:00';
INSERT INTO translation_memory (source_hash, target_lang, source_text, translated_text, provider, is_override, created_at, updated_at)
VALUES
(SHA2('Sign in to {app}', 256), 'fr', 'Sign in to {app}', 'Se connecter à {app}', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'de', 'Sign in to {app}', 'Bei {app} anmelden', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'it', 'Sign in to {app}', 'Accedi a {app}', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'ja', 'Sign in to {app}', '{app}にサインイン', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'ko', 'Sign in to {app}', '{app}에 로그인', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'pt', 'Sign in to {app}', 'Entrar em {app}', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Sign in to {app}', 256), 'es', 'Sign in to {app}', 'Inicia sesión en {app}', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'fr', 'Names, club names and what members write stay as entered.', 'Les noms, les noms de club et ce que les membres écrivent restent tels qu''ils ont été saisis.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'de', 'Names, club names and what members write stay as entered.', 'Namen, Clubnamen und was Mitglieder schreiben, bleiben wie eingegeben.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'it', 'Names, club names and what members write stay as entered.', 'I nomi, i nomi dei club e ciò che scrivono i soci restano come sono stati inseriti.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'ja', 'Names, club names and what members write stay as entered.', '名前、クラブ名、会員が入力した内容は入力されたまま表示されます。', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'ko', 'Names, club names and what members write stay as entered.', '이름, 클럽 이름 및 회원이 작성한 내용은 입력한 그대로 표시됩니다.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'pt', 'Names, club names and what members write stay as entered.', 'Nomes, nomes de clubes e o que os associados escrevem ficam como foram digitados.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
(SHA2('Names, club names and what members write stay as entered.', 256), 'es', 'Names, club names and what members write stay as entered.', 'Los nombres, los nombres de club y lo que escriben los socios se mantienen tal como se introdujeron.', 'glossary', 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
    translated_text = IF(provider = 'correction', translated_text, VALUES(translated_text)),
    is_override = IF(provider = 'correction', is_override, 1),
    updated_at = IF(provider = 'correction', updated_at, UTC_TIMESTAMP()),
    provider = IF(provider = 'correction', provider, 'glossary');
INSERT INTO translation_memory_version (id, version) VALUES (1, 1) ON DUPLICATE KEY UPDATE version = version + 1;
