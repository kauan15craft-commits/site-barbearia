const config = window.BARBEARIA_SUPABASE;
const supabase = config?.url && config?.anonKey && window.supabase
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;

const loginPanel = document.querySelector("#painel-login");
const passwordPanel = document.querySelector("#painel-definir-senha");
const contentPanel = document.querySelector("#painel-conteudo");
const loginForm = document.querySelector("#form-login");
const passwordForm = document.querySelector("#form-definir-senha");
const loginStatus = document.querySelector("#status-login");
const passwordStatus = document.querySelector("#status-definir-senha");
const panelStatus = document.querySelector("#status-painel");
const appointmentList = document.querySelector("#agenda-lista");
const refreshButton = document.querySelector("#botao-atualizar");
let refreshTimer;

const setStatus = (element, message, type = "") => {
    element.textContent = message;
    element.dataset.tipo = type;
};

const formatDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");

const carregarAgendamentos = async () => {
    setStatus(panelStatus, "Carregando pedidos...");
    appointmentList.replaceChildren();

    const { data: appointments, error } = await supabase
        .from("appointments")
        .select("id, customer_name, customer_phone, service, appointment_date, appointment_time, status")
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true });

    if (error) {
        setStatus(panelStatus, "Não foi possível carregar os agendamentos.", "erro");
        console.error("Erro ao carregar agendamentos:", error);
        return;
    }

    if (appointments.length === 0) {
        setStatus(panelStatus, "Ainda não há pedidos de agendamento.");
        return;
    }

    setStatus(panelStatus, "");
    appointments.forEach((appointment) => {
        const card = document.createElement("article");
        card.className = "agendamento-item";

        const info = document.createElement("div");
        info.className = "agendamento-item-info";
        const name = document.createElement("h2");
        name.textContent = appointment.customer_name;
        const details = document.createElement("p");
        details.textContent = `${appointment.service} · ${formatDate(appointment.appointment_date)} às ${appointment.appointment_time.slice(0, 5)}`;
        const phone = document.createElement("p");
        phone.textContent = appointment.customer_phone;
        const status = document.createElement("span");
        status.className = `status-badge status-${appointment.status}`;
        status.textContent = appointment.status === "pending"
            ? "Pendente"
            : appointment.status === "confirmed"
                ? "Confirmado"
                : "Recusado";
        info.append(name, details, phone, status);
        card.append(info);

        if (appointment.status === "pending") {
            const actions = document.createElement("div");
            actions.className = "agendamento-acoes";
            actions.append(
                criarBotaoAcao(appointment.id, "confirmed", "Confirmar", "botao-destaque"),
                criarBotaoAcao(appointment.id, "rejected", "Recusar", "botao-contorno")
            );
            card.append(actions);
        }

        appointmentList.append(card);
    });
};

const criarBotaoAcao = (id, status, label, style) => {
    const button = document.createElement("button");
    button.className = `botao ${style}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
        button.disabled = true;
        const { error } = await supabase
            .from("appointments")
            .update({ status })
            .eq("id", id)
            .eq("status", "pending");

        if (error) {
            setStatus(panelStatus, "Não foi possível atualizar o pedido.", "erro");
            console.error("Erro ao atualizar agendamento:", error);
        } else {
            await carregarAgendamentos();
        }
    });
    return button;
};

const atualizarSessao = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        setStatus(loginStatus, "Não foi possível verificar o acesso.", "erro");
        console.error("Erro ao verificar sessão:", error);
        return;
    }

    const tipoConvite = new URLSearchParams(window.location.hash.slice(1)).get("type");
    if (session && (tipoConvite === "invite" || tipoConvite === "recovery")) {
        loginPanel.hidden = true;
        passwordPanel.hidden = false;
        contentPanel.hidden = true;
        return;
    }

    if (!session) {
        loginPanel.hidden = false;
        passwordPanel.hidden = true;
        contentPanel.hidden = true;
        return;
    }

    const { data: isAdmin, error: permissionError } = await supabase.rpc("is_barber_admin");
    if (permissionError || !isAdmin) {
        await supabase.auth.signOut();
        loginPanel.hidden = false;
        passwordPanel.hidden = true;
        contentPanel.hidden = true;
        setStatus(loginStatus, "Este usuário não tem permissão para acessar a agenda.", "erro");
        if (permissionError) {
            console.error("Erro ao verificar permissão do barbeiro:", permissionError);
        }
        return;
    }

    loginPanel.hidden = true;
    passwordPanel.hidden = true;
    contentPanel.hidden = false;
    await carregarAgendamentos();
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
            carregarAgendamentos();
        }
    }, 30_000);
};

if (!supabase) {
    setStatus(loginStatus, "Configure o acesso ao Supabase antes de entrar.", "erro");
    loginForm.querySelector("button").disabled = true;
} else {
    atualizarSessao();

    passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const senha = document.querySelector("#senha-nova").value;
        const confirmacao = document.querySelector("#senha-confirmacao").value;

        if (senha !== confirmacao) {
            setStatus(passwordStatus, "As senhas não conferem.", "erro");
            return;
        }

        const button = passwordForm.querySelector("button");
        button.disabled = true;
        setStatus(passwordStatus, "Salvando senha...");

        const { error } = await supabase.auth.updateUser({ password: senha });

        button.disabled = false;
        if (error) {
            setStatus(passwordStatus, "Não foi possível salvar a senha. Tente novamente.", "erro");
            console.error("Erro ao definir senha:", error);
            return;
        }

        passwordForm.reset();
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        setStatus(passwordStatus, "Senha salva.", "sucesso");
        await atualizarSessao();
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = loginForm.querySelector("button");
        button.disabled = true;
        setStatus(loginStatus, "Verificando acesso...");

        const { error } = await supabase.auth.signInWithPassword({
            email: document.querySelector("#email-admin").value.trim(),
            password: document.querySelector("#senha-admin").value
        });

        button.disabled = false;
        if (error) {
            setStatus(loginStatus, "E-mail ou senha inválidos, ou acesso não autorizado.", "erro");
            console.error("Erro no login do administrador:", error);
            return;
        }

        await atualizarSessao();
    });

    document.querySelector("#botao-sair").addEventListener("click", async () => {
        window.clearInterval(refreshTimer);
        const { error } = await supabase.auth.signOut();
        if (error) {
            setStatus(panelStatus, "Não foi possível encerrar a sessão.", "erro");
            console.error("Erro ao sair:", error);
            return;
        }
        loginPanel.hidden = false;
        contentPanel.hidden = true;
    });

    refreshButton.addEventListener("click", carregarAgendamentos);
}
