package dev.shlyapcord.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.shlyapcord.config.AppProperties;
import dev.shlyapcord.entity.UserAccount;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private static final Base64.Encoder BASE64_URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder BASE64_URL_DECODER = Base64.getUrlDecoder();
    private static final Duration ACCESS_TOKEN_TTL = Duration.ofMinutes(15);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ObjectMapper objectMapper;
    private final AppProperties appProperties;
    private PrivateKey privateKey;
    private PublicKey publicKey;

    public JwtService(ObjectMapper objectMapper, AppProperties appProperties) {
        this.objectMapper = objectMapper;
        this.appProperties = appProperties;
    }

    @PostConstruct
    void init() {
        try {
            AppProperties.Auth auth = appProperties.getAuth();
            if (isBlank(auth.getJwtPrivateKey()) && isBlank(auth.getJwtPublicKey())) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
                generator.initialize(2048);
                KeyPair keyPair = generator.generateKeyPair();
                privateKey = keyPair.getPrivate();
                publicKey = keyPair.getPublic();
                return;
            }
            if (isBlank(auth.getJwtPrivateKey()) || isBlank(auth.getJwtPublicKey())) {
                throw new IllegalStateException("Both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be configured");
            }
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            privateKey = keyFactory.generatePrivate(new PKCS8EncodedKeySpec(decodePem(auth.getJwtPrivateKey())));
            publicKey = keyFactory.generatePublic(new X509EncodedKeySpec(decodePem(auth.getJwtPublicKey())));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to initialize RSA JWT keys", exception);
        }
    }

    public String issueAccessToken(UserAccount user, UUID sessionId) {
        try {
            Instant now = Instant.now();
            Instant expiresAt = now.plus(ACCESS_TOKEN_TTL);
            Map<String, Object> header = Map.of("alg", "RS256", "typ", "JWT");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("sub", user.getId().toString());
            payload.put("sessionId", sessionId.toString());
            payload.put("login", user.getLogin());
            payload.put("nickname", user.getNickname());
            payload.put("iat", now.getEpochSecond());
            payload.put("exp", expiresAt.getEpochSecond());

            String unsignedToken = encodeJson(header) + "." + encodeJson(payload);
            return unsignedToken + "." + sign(unsignedToken);
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to issue access token", exception);
        }
    }

    public JwtClaims validate(String token) {
        try {
            String[] parts = token == null ? new String[0] : token.split("\\.");
            if (parts.length != 3) {
                throw new JwtValidationException("Invalid JWT format");
            }

            Map<String, Object> header = decodeJson(parts[0]);
            if (!"RS256".equals(header.get("alg"))) {
                throw new JwtValidationException("Unsupported JWT alg");
            }

            String unsignedToken = parts[0] + "." + parts[1];
            if (!verify(unsignedToken, parts[2])) {
                throw new JwtValidationException("Invalid JWT signature");
            }

            Map<String, Object> payload = decodeJson(parts[1]);
            Instant expiresAt = Instant.ofEpochSecond(asLong(payload.get("exp")));
            if (!expiresAt.isAfter(Instant.now())) {
                throw new JwtValidationException("Access token expired");
            }

            return new JwtClaims(
                UUID.fromString(asString(payload.get("sub"))),
                UUID.fromString(asString(payload.get("sessionId"))),
                asString(payload.get("login")),
                asString(payload.get("nickname")),
                Instant.ofEpochSecond(asLong(payload.get("iat"))),
                expiresAt
            );
        } catch (JwtValidationException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new JwtValidationException("Invalid access token", exception);
        }
    }

    private String encodeJson(Map<String, Object> value) throws Exception {
        return BASE64_URL_ENCODER.encodeToString(objectMapper.writeValueAsBytes(value));
    }

    private Map<String, Object> decodeJson(String value) throws Exception {
        byte[] json = BASE64_URL_DECODER.decode(value);
        return objectMapper.readValue(json, MAP_TYPE);
    }

    private String sign(String unsignedToken) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(privateKey);
        signature.update(unsignedToken.getBytes(StandardCharsets.UTF_8));
        return BASE64_URL_ENCODER.encodeToString(signature.sign());
    }

    private boolean verify(String unsignedToken, String encodedSignature) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(publicKey);
        signature.update(unsignedToken.getBytes(StandardCharsets.UTF_8));
        return signature.verify(BASE64_URL_DECODER.decode(encodedSignature));
    }

    private byte[] decodePem(String value) {
        String normalized = value
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace("\\n", "")
            .replaceAll("\\s", "");
        return Base64.getDecoder().decode(normalized);
    }

    private String asString(Object value) {
        if (value == null) {
            throw new JwtValidationException("Missing JWT claim");
        }
        return value.toString();
    }

    private long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.parseLong(asString(value));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
