package dev.shlyapcord.model;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ClientMessage {
    private String type;
    private String targetUserId;
    private JsonNode payload;
}
