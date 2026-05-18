package dev.shlyapcord.config;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shlyapcord")
public class AppProperties {
    private List<String> invites = new ArrayList<>();
    private List<String> corsOrigins = new ArrayList<>(List.of("*"));
    private Ice ice = new Ice();

    public List<String> getInvites() {
        return invites;
    }

    public void setInvites(List<String> invites) {
        this.invites = invites;
    }

    public List<String> getCorsOrigins() {
        return corsOrigins;
    }

    public void setCorsOrigins(List<String> corsOrigins) {
        this.corsOrigins = corsOrigins;
    }

    public Ice getIce() {
        return ice;
    }

    public void setIce(Ice ice) {
        this.ice = ice;
    }

    public static class Ice {
        private String stunUrl;
        private String turnUrl;
        private String turnUsername;
        private String turnCredential;

        public String getStunUrl() {
            return stunUrl;
        }

        public void setStunUrl(String stunUrl) {
            this.stunUrl = stunUrl;
        }

        public String getTurnUrl() {
            return turnUrl;
        }

        public void setTurnUrl(String turnUrl) {
            this.turnUrl = turnUrl;
        }

        public String getTurnUsername() {
            return turnUsername;
        }

        public void setTurnUsername(String turnUsername) {
            this.turnUsername = turnUsername;
        }

        public String getTurnCredential() {
            return turnCredential;
        }

        public void setTurnCredential(String turnCredential) {
            this.turnCredential = turnCredential;
        }
    }
}
